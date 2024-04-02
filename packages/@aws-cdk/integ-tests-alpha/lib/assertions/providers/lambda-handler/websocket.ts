/* eslint-disable no-console */
// eslint-disable-next-line import/no-extraneous-dependencies
import fetch, { Response } from 'node-fetch';
// TODO: can use builtin fetch on node18
import { CustomResourceHandler } from './base';
import { WebSocketRequest, WebSocketResponseWrapper } from './types';
import * as WebSocket from 'ws';

export class WebSocketHandler extends CustomResourceHandler<WebSocketRequest, WebSocketResponseWrapper> {
  protected async processEvent(request: WebSocketRequest): Promise<WebSocketResponseWrapper> {
    console.log('request', request);
    // TODO

    const webSocket = new WebSocket();

    const response: Response = await fetch(request.parameters.url/* , request.parameters.options */);
    const result: any = {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers.raw(),
    };

    result.body = await response.text();
    try {
      result.body = JSON.parse(result.body);
    } catch (e) {
      // Okay
    }
    return {
      apiCallResponse: result,
    };
  }
}
