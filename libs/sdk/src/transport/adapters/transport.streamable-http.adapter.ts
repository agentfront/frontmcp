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
      // Disable eventStore to prevent priming events - Claude.ai's client doesn't handle them
      // The priming event has empty data with no `event:` type, which violates MCP spec
      // ("Event types MUST be message") and confuses some clients
      eventStore: undefined,
    });
  }

  initialize(req: AuthenticatedServerRequest, res: ServerResponse): Promise<void> {
    this.ensureAuthInfo(req, this);

    this.logger.info('[StreamableHttpAdapter] initialize() called', {
      method: req.method,
      sessionId: this.key.sessionId.slice(0, 30),
      bodyMethod: (req.body as { method?: string })?.method,
    });

    // Intercept response to log what gets sent back to client
    const originalWrite = res.write.bind(res) as typeof res.write;
    const originalEnd = res.end.bind(res) as typeof res.end;
    let responseBody = '';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res.write = function (this: ServerResponse, chunk: any, encodingOrCb?: any, cb?: any): boolean {
      if (chunk) {
        responseBody += typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
      }
      return originalWrite.call(this, chunk, encodingOrCb, cb);
    } as typeof res.write;

    const adapter = this;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res.end = function (this: ServerResponse, chunk?: any, encodingOrCb?: any, cb?: any): ServerResponse {
      if (chunk) {
        responseBody += typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
      }
      adapter.logger.info('[StreamableHttpAdapter] initialize response', {
        statusCode: res.statusCode,
        headers: res.getHeaders?.() ?? {},
        bodyPreview: responseBody.slice(0, 1000),
      });
      return originalEnd.call(this, chunk, encodingOrCb, cb);
    } as typeof res.end;

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
