import { AuthenticatedServerRequest } from '../../server/server.types';
import { TransportKey, TypedElicitResult } from '../transport.types';
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { EmptyResultSchema, ElicitResult, RequestId, ElicitResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { InMemoryEventStore } from '../transport.event-store';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '../legacy/legacy.sse.tranporter';
import { ZodObject } from 'zod';
import { FrontMcpLogger, ServerRequestTokens, ServerResponse } from '../../common';
import { Scope } from '../../scope';
import { createMcpHandlers } from '../mcp-handlers';

export abstract class LocalTransportAdapter<T extends StreamableHTTPServerTransport | SSEServerTransport> {
  protected logger: FrontMcpLogger;
  protected transport: T;
  protected eventStore = new InMemoryEventStore();
  protected elicitHandler: { resolve: (result: ElicitResult) => void; reject: (err: unknown) => void } | undefined =
    undefined;
  #requestId = 1;
  ready: Promise<void>;
  server: McpServer;

  constructor(
    protected readonly scope: Scope,
    protected readonly key: TransportKey,
    protected readonly onDispose: () => void,
    res: ServerResponse,
  ) {
    this.logger = scope.logger.child('LocalTransportAdapter');
    this.transport = this.createTransport(key.sessionId, res);
    this.ready = this.connectServer();
  }

  abstract createTransport(sessionId: string, response: ServerResponse): T;

  abstract initialize(req: AuthenticatedServerRequest, res: ServerResponse): Promise<void>;

  abstract sendElicitRequest<T extends ZodObject<any>>(
    relatedRequestId: RequestId,
    message: string,
    requestedSchema: T,
  ): Promise<TypedElicitResult<T>>;

  abstract handleRequest(req: AuthenticatedServerRequest, res: ServerResponse): Promise<void>;

  connectServer() {
    const { info } = this.scope.metadata;

    const serverOptions = {
      instructions: '',
      capabilities: {
        tools: {
          subscribe: true,
          listChanged: true,
        },
        resources: this.scope.resources.getCapabilities(),
        prompts: this.scope.prompts.getCapabilities(),
      },
      serverInfo: info,
    };
    this.server = new McpServer(info, serverOptions);
    const handlers = createMcpHandlers({
      scope: this.scope,
      serverOptions,
    });

    for (const handler of handlers) {
      this.server.setRequestHandler(handler.requestSchema, handler.handler as any);
    }
    return this.server.connect(this.transport);
  }

  get newRequestId(): RequestId {
    return this.#requestId++;
  }

  async destroy(reason?: string): Promise<void> {
    console.log('destroying transporter, reason:', reason);

    try {
      // if(!this.transport.closed){
      //   this.transport.close();
      // }
    } catch {
      /* empty */
    }
    if (reason) {
      console.warn(`Destroying transporter: ${reason}`);
    } else {
      try {
        this.onDispose?.();
      } catch {
        /* empty */
      }
    }
  }

  /**
   * Ping the connected client for this transport.
   * Returns true on success, false on timeout/error.
   */
  async ping(timeoutMs = 10_000): Promise<boolean> {
    try {
      await this.ready; // ensure server.connect(...) finished
      // Preferred if your SDK exposes it:
      // await this.server.ping({ timeout: timeoutMs });

      // Works on all versions (low-level request):
      await this.server.request({ method: 'ping' }, EmptyResultSchema, { timeout: timeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  protected ensureAuthInfo(req: AuthenticatedServerRequest, transport: LocalTransportAdapter<T>) {
    const { token, user, session } = req[ServerRequestTokens.auth];
    req.auth = {
      token,
      user,
      sessionId: session!.id,
      sessionIdPayload: session!.payload,
      scopes: [],
      clientId: user.sub ?? '',
      transport,
    } satisfies AuthInfo;
    return req.auth;
  }

  handleIfElicitResult(req: AuthenticatedServerRequest): boolean {
    if (!this.elicitHandler) {
      return false;
    }
    if (req.body.error) {
      const { code, message } = req.body.error;
      if (code === -32600 && message === 'Elicitation not supported') {
        this.elicitHandler.reject(req.body.error);
        return true;
      }
      return false;
    }

    const parsed = ElicitResultSchema.safeParse(req.body?.result);
    if (parsed.success) {
      this.elicitHandler.resolve(parsed.data);
      return true;
    }
    return false;
  }
}
