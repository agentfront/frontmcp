import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { TransportType, TypedElicitResult } from '../transport.types';
import { AuthenticatedServerRequest } from '../../server/server.types';
import { LocalTransportAdapter } from './transport.local.adapter';
import { RequestId } from '@modelcontextprotocol/sdk/types.js';
import { ZodType } from 'zod';
import { toJSONSchema } from 'zod/v4';
import { rpcRequest } from '../transport.error';
import { ServerResponse } from '../../common';

/**
 * Stateless HTTP requests must be able to send multiple initialize calls without
 * tripping the MCP transport's "already initialized" guard. The upstream SDK
 * treats any transport with a session ID generator as stateful, so we disable
 * session generation entirely for stateless transports.
 */
export const resolveSessionIdGenerator = (
  transportType: TransportType,
  sessionId: string,
): (() => string) | undefined => {
  return transportType === 'stateless-http' ? undefined : () => sessionId;
};

export class TransportStreamableHttpAdapter extends LocalTransportAdapter<StreamableHTTPServerTransport> {
  override createTransport(sessionId: string, response: ServerResponse): StreamableHTTPServerTransport {
    const sessionIdGenerator = resolveSessionIdGenerator(this.key.type, sessionId);

    return new StreamableHTTPServerTransport({
      sessionIdGenerator,
      onsessionclosed: () => {
        // this.destroy();
      },
      onsessioninitialized: (sessionId) => {
        if (sessionId) {
          console.log(`session initialized: ${sessionId.slice(0, 40)}`);
        } else {
          console.log(`stateless session initialized`);
        }
      },
      eventStore: this.eventStore,
    });
  }

  initialize(req: AuthenticatedServerRequest, res: ServerResponse): Promise<void> {
    this.ensureAuthInfo(req, this);
    return this.transport.handleRequest(req, res, req.body);
  }

  async handleRequest(req: AuthenticatedServerRequest, res: ServerResponse): Promise<void> {
    this.ensureAuthInfo(req, this);
    //
    // if ((await this.isInitialized) && isInitializeRequest(req.body)) {
    //   await this.transport.close();
    //   this.isInitialized = this.connectStreamableTransport(req.authSession.session!.id);
    //   await this.ready;
    // }

    if (req.method === 'GET') {
      return this.transport.handleRequest(req, res);
    } else {
      if (this.handleIfElicitResult(req)) {
        return;
      }
      return this.transport.handleRequest(req, res, req.body);
    }
  }

  async sendElicitRequest<T extends ZodType>(
    relatedRequestId: RequestId,
    message: string,
    requestedSchema: T,
  ): Promise<TypedElicitResult<T>> {
    await this.transport.send(
      rpcRequest(this.newRequestId, 'elicitation/create', {
        message,
        requestedSchema: toJSONSchema(requestedSchema as any),
      }),
      { relatedRequestId },
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
