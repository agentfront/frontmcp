import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { TypedElicitResult } from '../transport.types';
import { AuthenticatedServerRequest } from '../../server/server.types';
import { LocalTransportAdapter } from './transport.local.adapter';
import { RequestId } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ZodObject } from 'zod';
import { rpcRequest } from '../transport.error';
import { ServerResponse } from '@frontmcp/sdk';

export class TransportStreamableHttpAdapter extends LocalTransportAdapter<StreamableHTTPServerTransport> {

  override createTransport(sessionId: string, response: ServerResponse): StreamableHTTPServerTransport {
      return new StreamableHTTPServerTransport({
        sessionIdGenerator: () => {
          return sessionId
        },
        onsessionclosed: () => {
          // this.destroy();
        },
        onsessioninitialized: (sessionId) => {
          console.log(`session initialized: ${sessionId.slice(0, 40)}`);
        },
        eventStore: this.eventStore,
      })
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

  async sendElicitRequest<T extends ZodObject<any>>(
    relatedRequestId: RequestId,
    message: string,
    requestedSchema: T,
  ): Promise<TypedElicitResult<T>> {
    await this.transport.send(
      rpcRequest(this.newRequestId, 'elicitation/create', {
        message,
        requestedSchema: zodToJsonSchema(requestedSchema),
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
