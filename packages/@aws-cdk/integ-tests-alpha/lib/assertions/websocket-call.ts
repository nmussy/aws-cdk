import { Aspects, CfnOutput, CustomResource, Lazy, Token } from 'aws-cdk-lib';
import { Construct, IConstruct } from 'constructs';
import { ApiCallBase, IApiCall } from './api-call-base';
import { ExpectedResult } from './common';
import { AssertionsProvider, WebSocketRequestParameters, WEBSOCKET_RESOURCE_TYPE } from './providers';
import { WaiterStateMachine, WaiterStateMachineOptions } from './waiter-state-machine';

/**
 * Options for creating an WebSocketApiCall provider
 */
export interface WebSocketCallProps extends WebSocketRequestParameters { }
/**
 * Construct that creates a custom resource that will perform
 * a WebSocket API Call
 */
export class WebSocketApiCall extends ApiCallBase {
  protected readonly apiCallResource: CustomResource;
  public readonly provider: AssertionsProvider;

  constructor(scope: Construct, id: string, props: WebSocketCallProps) {
    super(scope, id);

    let name = '';
    if (!Token.isUnresolved(props.url)) {
      const url = new URL(props.url);
      name = `${url.hostname}${url.pathname}`.replace(/\/|\.|:/g, '');
    }
    this.provider = new AssertionsProvider(this, 'WebSocketProvider');
    this.apiCallResource = new CustomResource(this, 'Default', {
      serviceToken: this.provider.serviceToken,
      properties: {
        parameters: props,
        expected: Lazy.any({ produce: () => this.expectedResult }),
        stateMachineArn: Lazy.string({ produce: () => this.stateMachineArn }),
        salt: Date.now().toString(),
      },
      resourceType: `${WEBSOCKET_RESOURCE_TYPE}${name}`.substring(0, 60),
    });

    // Needed so that all the policies set up by the provider should be available before the custom resource is provisioned.
    this.apiCallResource.node.addDependency(this.provider);
    Aspects.of(this).add({
      visit(node: IConstruct) {
        if (node instanceof WebSocketApiCall) {
          if (node.expectedResult) {
            const result = node.apiCallResource.getAttString('assertion');

            new CfnOutput(node, 'AssertionResults', {
              value: result,
            }).overrideLogicalId(`AssertionResults${id}`);
          }
        }
      },
    });
  }

  public assertAtPath(_path: string, _expected: ExpectedResult): IApiCall {
    return this;
  }
  public waitForAssertions(options?: WaiterStateMachineOptions | undefined): IApiCall {
    const waiter = new WaiterStateMachine(this, 'WaitFor', {
      ...options,
    });
    this.stateMachineArn = waiter.stateMachineArn;
    this.provider.addPolicyStatementFromSdkCall('states', 'StartExecution');
    return this;
  };
}
