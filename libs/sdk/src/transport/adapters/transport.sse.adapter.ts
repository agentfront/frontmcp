import { AuthenticatedServerRequest } from '../../server/server.types';
import { TypedElicitResult } from '../transport.types';
import { SSEServerTransport } from '../legacy/legacy.sse.tranporter';
import { LocalTransportAdapter } from './transport.local.adapter';
import { RequestId } from '@modelcontextprotocol/sdk/types.js';
import { ZodType } from 'zod';
import { toJSONSchema } from 'zod/v4';
import { rpcRequest } from '../transport.error';
import { ServerResponse } from '../../common';

export class TransportSSEAdapter extends LocalTransportAdapter<SSEServerTransport> {
  sessionId: string;

  override createTransport(sessionId: string, res: ServerResponse): SSEServerTransport {
    this.sessionId = sessionId;
    this.logger.info(`new transport session: ${sessionId.slice(0, 40)}`);
    const scopePath = this.scope.fullPath;
    const transport = new SSEServerTransport(`${scopePath}/message`, res, {
      sessionId: sessionId,
    });
    transport.onerror = (error) => {
      // Use safe logging to avoid Node.js 24 util.inspect bug with Zod errors
      console.error('SSE error:', error instanceof Error ? error.message : 'Unknown error');
    };
    transport.onclose = this.destroy.bind(this);
    return transport;
  }

  initialize(req: AuthenticatedServerRequest, res: ServerResponse): Promise<void> {
    this.logger.verbose(`[${this.sessionId}] handle initialize request`);
    this.ensureAuthInfo(req, this);
    return Promise.resolve();
  }

  async handleRequest(req: AuthenticatedServerRequest, res: ServerResponse): Promise<void> {
    const authInfo = this.ensureAuthInfo(req, this);

    if (this.handleIfElicitResult(req)) {
      this.logger.verbose(`[${this.sessionId}] handle get request`);
      return;
    }
    if (req.method === 'GET') {
      this.logger.verbose(`[${this.sessionId}] handle get request`);
      return this.transport.handleMessage(req.body, { requestInfo: req, authInfo });
    } else {
      this.logger.verbose(`[${this.sessionId}] handle post request`);
      return this.transport.handlePostMessage(req, res, req.body);
    }
  }

  async sendElicitRequest<T extends ZodType>(
    relatedRequestId: RequestId,
    message: string,
    requestedSchema: T,
  ): Promise<TypedElicitResult<T>> {
    console.log('sendElicitRequest', { relatedRequestId });
    await this.transport.send(
      rpcRequest(this.newRequestId, 'elicitation/create', {
        message,
        requestedSchema: toJSONSchema(requestedSchema as any),
      }),
    );

    return new Promise<TypedElicitResult<T>>((resolve, reject) => {
      this.elicitHandler = {
        resolve: (result) => {
          resolve(result as TypedElicitResult<T>);
          this.elicitHandler = undefined;
        },
        reject: (err) => {
          reject(err);
          this.elicitHandler = undefined;
        },
      };
    });
  }
}
