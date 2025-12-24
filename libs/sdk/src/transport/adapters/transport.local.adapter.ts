import { AuthenticatedServerRequest } from '../../server/server.types';
import { TransportKey, TypedElicitResult } from '../transport.types';
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { EmptyResultSchema, ElicitResult, RequestId, ElicitResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { InMemoryEventStore } from '../transport.event-store';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '../legacy/legacy.sse.tranporter';
import { RecreateableStreamableHTTPServerTransport } from './streamable-http-transport';
import { ZodType } from 'zod';
import { FrontMcpLogger, ServerRequestTokens, ServerResponse } from '../../common';
import { Scope } from '../../scope';
import { createMcpHandlers } from '../mcp-handlers';

/**
 * Base transport type that includes all supported transports.
 * RecreateableStreamableHTTPServerTransport extends StreamableHTTPServerTransport
 * so it's also included in this union.
 */
export type SupportedTransport =
  | StreamableHTTPServerTransport
  | SSEServerTransport
  | RecreateableStreamableHTTPServerTransport;

export abstract class LocalTransportAdapter<T extends SupportedTransport> {
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

  abstract sendElicitRequest<T extends ZodType>(
    relatedRequestId: RequestId,
    message: string,
    requestedSchema: T,
  ): Promise<TypedElicitResult<T>>;

  abstract handleRequest(req: AuthenticatedServerRequest, res: ServerResponse): Promise<void>;

  /**
   * Marks this transport as pre-initialized for session recreation.
   * Override in subclasses that need to set the MCP SDK's _initialized flag.
   */
  markAsInitialized(): void {
    // Default no-op - override in subclasses
  }

  connectServer() {
    const { info } = this.scope.metadata;

    // Check if completions capability should be enabled (when prompts or resources are present)
    const hasPrompts = this.scope.prompts.hasAny();
    const hasResources = this.scope.resources.hasAny();
    const hasTools = this.scope.tools.hasAny();
    const completionsCapability = hasPrompts || hasResources ? { completions: {} } : {};

    const serverOptions = {
      instructions: '',
      capabilities: {
        ...this.scope.tools.getCapabilities(),
        ...this.scope.resources.getCapabilities(),
        ...this.scope.prompts.getCapabilities(),
        ...completionsCapability,
        // MCP logging protocol support - allows clients to set log level via logging/setLevel
        logging: {},
      },
      serverInfo: info,
    };

    this.logger.info('connectServer: advertising capabilities', {
      hasTools,
      hasResources,
      hasPrompts,
      capabilities: JSON.stringify(serverOptions.capabilities),
      serverInfo: JSON.stringify(serverOptions.serverInfo),
    });

    this.server = new McpServer(info, serverOptions);
    const handlers = createMcpHandlers({
      scope: this.scope,
      serverOptions,
    });

    for (const handler of handlers) {
      this.server.setRequestHandler(handler.requestSchema, handler.handler as any);
    }

    // Register server with notification service for server→client notifications
    this.scope.notifications.registerServer(this.key.sessionId, this.server);

    return this.server.connect(this.transport);
  }

  get newRequestId(): RequestId {
    return this.#requestId++;
  }

  async destroy(reason?: string): Promise<void> {
    console.log('destroying transporter, reason:', reason);

    // Unregister server from notification service
    this.scope.notifications.unregisterServer(this.key.sessionId);

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

    // Session should always exist now (created in session.verify for public mode)
    // But add defensive fallback for safety in case session is undefined
    const sessionId = session?.id ?? `fallback:${Date.now()}`;
    const sessionPayload = session?.payload ?? { protocol: 'streamable-http' as const };

    req.auth = {
      token,
      user,
      sessionId,
      sessionIdPayload: sessionPayload,
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
