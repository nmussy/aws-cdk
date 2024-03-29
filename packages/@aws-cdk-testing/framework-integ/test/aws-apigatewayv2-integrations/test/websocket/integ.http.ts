import * as integ from '@aws-cdk/integ-tests-alpha';
import { App, CfnOutput, Duration, Stack } from 'aws-cdk-lib';
import { HttpApi, WebSocketApi, WebSocketStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration, WebSocketHttpIntegration, WebSocketHttpIntegrationProps, WebSocketHttpProxyIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
// import * as iam from 'aws-cdk-lib/aws-iam';
// import * as logs from 'aws-cdk-lib/aws-logs';
import * as assert from 'node:assert';

/*
 * Stack verification steps:
 * 1. Connect: 'wscat -c <endpoint-in-the-stack-output>'. Should connect successfully and print event data containing connectionId in cloudwatch
 * 2. HTTP: '> {"action": "http", "data": "some-data"}'. Should send the message successfully and print the data in cloudwatch
 * 2. HTTP Proxy: '> {"action": "http-proxy", "data": "some-data"}'. Should send the message successfully and print the data in cloudwatch
 */

const app = new App();
const stack = new Stack(app, 'WebSocketHttpApiInteg');

// We first create an HTTP endpoint and API to have something to proxy
const httpHandler = new lambda.Function(stack, 'HttpHandler', {
  runtime: lambda.Runtime.NODEJS_18_X,
  handler: 'index.handler',
  code: new lambda.InlineCode(`
  exports.handler = async (event) => {
    console.log(event);
    const { requestContext: { http: { method } }, headers, body: requestBody } = event;

    const integHeaders = Object.fromEntries(
      Object.entries(headers).filter(([key]) => key.startsWith('X-Integ')),
    );

    const parsedBody = JSON.parse(requestBody ?? 'null');
    if (parsedBody.myInputError) {
      return {
        statusCode: parsedBody.myInputError,
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ message: 'WS triggered error: ' + parsedBody.myInputError }),
      };
    }

    const resultBody = JSON.stringify({
      success: true,
      requestReceivedByHttpEndpoint: {
        method,
        integHeaders,
        parsedBody,
      }
    });

    return {
      statusCode: 200,
      headers: {'Content-Type': 'application/json'},
      body: resultBody,
    };
  };`),
});

const httpApi = new HttpApi(stack, 'HttpApi', {
  defaultIntegration: new HttpLambdaIntegration('DefaultIntegration', httpHandler),
});
assert(httpApi.url, 'HTTP API URL is required');

const defaultIntegrationProps = {
  integrationUri: httpApi.url,
  timeout: Duration.seconds(5),
  requestParameters: {
    'integration.request.header.Content-Type': '\'application/json\'',
  },
} satisfies Partial<WebSocketHttpIntegrationProps>;

const webSocketApi = new WebSocketApi(stack, 'WebSocketApi');

webSocketApi.addRoute('http', {
  integration: new WebSocketHttpIntegration('WebsocketHttpIntegration', {
    ...defaultIntegrationProps,
    templateSelectionExpression: '\\$default',
    requestTemplates: {
      $default: JSON.stringify({
        myInputError: "$input.path('$.triggerError')",
        myInputData: "$input.path('$.data')",
        stage: '$context.stage',
      }),
    },
    // TODO document ordering, last one wins
    integrationResponses: [
      { key: '/2\\d{2}/' },
      {
        key: '/4\\d{2}/',
        responseTemplates: {
          'application/json': JSON.stringify({ error: 'Bad Request', message: 'integration.response.body.message' }),
        },
      },
      {
        key: '/499/',
        responseTemplates: {
          'application/json': JSON.stringify({ message: '4 9 9' }),
        },
      },
    ],
  }),
  // TODO auto add integrationResponse for { key: '/2\\d{2}/' } if true and not provided?
  // Or just throw and tell the user to add it?
  returnResponse: true,
});

webSocketApi.addRoute('http-proxy', {
  integration: new WebSocketHttpProxyIntegration('WebsocketHttpIntegration', {
    ...defaultIntegrationProps,
  }),
  returnResponse: true,
});

const stage = new WebSocketStage(stack, 'mystage', {
  webSocketApi,
  stageName: 'dev',
  autoDeploy: true,
});

// FIXME https://github.com/aws/aws-cdk/issues/11100
/* const accessLogs = new logs.LogGroup(stack, 'APIGW-AccessLogs');
(stage.node.defaultChild as CfnStage).accessLogSettings = {
  destinationArn: accessLogs.logGroupArn,
  format: JSON.stringify({
    requestId: '$context.requestId',
    userAgent: '$context.identity.userAgent',
    sourceIp: '$context.identity.sourceIp',
    requestTime: '$context.requestTime',
    requestTimeEpoch: '$context.requestTimeEpoch',
    httpMethod: '$context.httpMethod',
    path: '$context.path',
    status: '$context.status',
    protocol: '$context.protocol',
    responseLength: '$context.responseLength',
    domainName: '$context.domainName',
  }),
};

const role = new iam.Role(stack, 'ApiGWLogWriterRole', {
  assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
});

const policy = new iam.PolicyStatement({
  actions: [
    'logs:CreateLogGroup',
    'logs:CreateLogStream',
    'logs:DescribeLogGroups',
    'logs:DescribeLogStreams',
    'logs:PutLogEvents',
    'logs:GetLogEvents',
    'logs:FilterLogEvents',
  ],
  resources: ['*'],
});

role.addToPolicy(policy);
accessLogs.grantWrite(role); */

new CfnOutput(stack, 'ApiEndpoint', { value: stage.url });

new integ.IntegTest(app, 'integ-tests', {
  testCases: [stack],
});

app.synth();