import { AuthenticatedServerRequest } from '../../server/server.types';
import { TransportKey, TransportType } from '../transport.types';
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { EmptyResultSchema, RequestId, ElicitResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { InMemoryEventStore } from '../transport.event-store';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '../legacy/legacy.sse.tranporter';
import { RecreateableStreamableHTTPServerTransport } from './streamable-http-transport';
import { RecreateableSSEServerTransport } from './sse-transport';
import { ZodType } from 'zod';
import { FrontMcpLogger, ServerRequestTokens, ServerResponse } from '../../common';
import { Scope } from '../../scope';
import { createMcpHandlers } from '../mcp-handlers';
import { ElicitResult, ElicitOptions, PendingElicit, ElicitationStore, McpElicitResult } from '../../elicitation';
import { ElicitationNotSupportedError } from '../../errors';

/**
 * Base transport type that includes all supported transports.
 * RecreateableStreamableHTTPServerTransport extends StreamableHTTPServerTransport
 * and RecreateableSSEServerTransport extends SSEServerTransport,
 * so they're also included in this union.
 */
export type SupportedTransport =
  | StreamableHTTPServerTransport
  | SSEServerTransport
  | RecreateableStreamableHTTPServerTransport
  | RecreateableSSEServerTransport;

export abstract class LocalTransportAdapter<T extends SupportedTransport> {
  protected logger: FrontMcpLogger;
  protected transport: T;
  protected eventStore = new InMemoryEventStore();

  /**
   * Pending elicitation request. Only one elicit per session is allowed.
   * New elicit requests will cancel any pending one.
   */
  protected pendingElicit?: PendingElicit;

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

  /**
   * Send an elicitation request to the client.
   *
   * @param relatedRequestId - The request ID that triggered this elicit
   * @param message - Message to display to the user
   * @param requestedSchema - Zod schema for the expected response
   * @param options - Elicit options (mode, ttl, elicitationId)
   * @returns ElicitResult with status and typed content
   */
  abstract sendElicitRequest<S extends ZodType>(
    relatedRequestId: RequestId,
    message: string,
    requestedSchema: S,
    options?: ElicitOptions,
  ): Promise<ElicitResult<S extends ZodType<infer O> ? O : unknown>>;

  abstract handleRequest(req: AuthenticatedServerRequest, res: ServerResponse): Promise<void>;

  /**
   * Marks this transport as pre-initialized for session recreation.
   * Override in subclasses that need to set the MCP SDK's _initialized flag.
   */
  markAsInitialized(): void {
    // Default no-op - override in subclasses
  }

  connectServer() {
    const { info, apps } = this.scope.metadata;

    // Check if there are remote apps configured (they will have tools/resources/prompts that load later)
    // Remote apps have 'urlType' property indicating they're external MCP servers
    const hasRemoteApps = apps?.some((app) => this.isRemoteApp(app)) ?? false;

    // Check if completions capability should be enabled (when prompts or resources are present)
    // Also enable for remote apps since they may have prompts/resources
    const hasPrompts = this.scope.prompts.hasAny() || hasRemoteApps;
    const hasResources = this.scope.resources.hasAny() || hasRemoteApps;
    const hasTools = this.scope.tools.hasAny() || hasRemoteApps;
    const hasAgents = this.scope.agents.hasAny();
    const completionsCapability = hasPrompts || hasResources ? { completions: {} } : {};

    // Get capabilities from registries - they now handle both local and remote capabilities
    // When hasRemoteApps is true, we pre-advertise listChanged capabilities since remote tools/resources/prompts
    // load asynchronously after connection and may emit change notifications
    const remoteCapabilities = hasRemoteApps ? this.buildRemoteCapabilities() : {};

    const serverOptions = {
      instructions: '',
      capabilities: {
        ...remoteCapabilities, // Pre-advertise for remote apps (may be overwritten by local)
        ...this.scope.tools.getCapabilities(),
        ...this.scope.resources.getCapabilities(),
        ...this.scope.prompts.getCapabilities(),
        ...this.scope.agents.getCapabilities(), // Include agent capabilities (agents as tools)
        ...completionsCapability,
        // MCP logging protocol support - allows clients to set log level via logging/setLevel
        logging: {},
      },
      serverInfo: info,
    };

    this.logger.info('connectServer: advertising capabilities', {
      hasTools: hasTools || hasAgents, // Agents expose themselves as tools
      hasResources,
      hasPrompts,
      hasAgents,
      hasRemoteApps,
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

  /**
   * Get the transport type (sse, streamable-http, etc.).
   * Used for transport-specific behavior detection.
   */
  get type(): TransportType {
    return this.key.type;
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

  /**
   * Get the elicitation store for distributed elicitation support.
   * Uses Redis in distributed mode, in-memory for single-node.
   */
  protected get elicitStore(): ElicitationStore {
    return this.scope.elicitationStore;
  }

  /**
   * Cancel any pending elicitation request.
   * Called before sending a new elicit to enforce single-elicit-per-session.
   *
   * This cancels both the local pending elicit (for timeout handling)
   * and publishes cancel to the store (for distributed mode).
   *
   * Note: The local promise is resolved immediately for responsiveness,
   * then distributed state cleanup follows asynchronously. This non-atomic
   * sequence is intentional - the worst case is publishing a cancel for
   * an already-processed elicitation, which is harmless.
   */
  protected async cancelPendingElicit(): Promise<void> {
    if (this.pendingElicit) {
      clearTimeout(this.pendingElicit.timeoutHandle);
      // Resolve local promise immediately for responsiveness
      this.pendingElicit.resolve({ status: 'cancel' });

      // Publish cancel to store for distributed mode (non-atomic, intentional)
      // In distributed mode, another node may have already processed this elicitation
      const sessionId = this.key.sessionId;
      const pending = await this.elicitStore.getPending(sessionId);
      if (pending) {
        await this.elicitStore.publishResult(pending.elicitId, sessionId, { status: 'cancel' });
      }

      this.pendingElicit = undefined;
      this.logger.info('Cancelled previous pending elicit');
    }
  }

  /**
   * Handle an incoming elicitation result from the client.
   * Returns true if the request was an elicit result and was handled.
   *
   * Uses ElicitationResultFlow for processing (with hook support).
   * In distributed mode, this publishes the result via the elicitation store,
   * which routes it to the correct node that's waiting for it.
   */
  handleIfElicitResult(req: AuthenticatedServerRequest): boolean {
    this.logger.info('[handleIfElicitResult] checking request', {
      hasPendingElicit: !!this.pendingElicit,
      bodyKeys: req.body ? Object.keys(req.body) : [],
      hasResult: !!req.body?.result,
    });
    // First, check for error response (client doesn't support elicitation)
    // This still needs the local pendingElicit for backwards compatibility
    if (this.pendingElicit && req.body.error) {
      const { code, message } = req.body.error;
      if (code === -32600 && message === 'Elicitation not supported') {
        clearTimeout(this.pendingElicit.timeoutHandle);
        this.pendingElicit.reject(new ElicitationNotSupportedError());
        this.pendingElicit = undefined;
        return true;
      }
    }

    // Parse the elicit result from the client
    const parsed = ElicitResultSchema.safeParse(req.body?.result);
    if (!parsed.success) {
      return false;
    }

    // Run ElicitationResultFlow for distributed routing (with hook support)
    // Flow handles: lookup pending, publish via pub/sub
    // Note: Using void to explicitly mark as fire-and-forget; errors are caught inside the method
    const sessionId = this.key.sessionId;
    void this.handleElicitResultAsync(sessionId, parsed.data);

    // Map MCP action to our result type for local handling
    const action = parsed.data.action;
    const result: ElicitResult = {
      status: action,
      ...(action === 'accept' && parsed.data.content !== undefined && { content: parsed.data.content }),
    };

    // Also handle local pending elicit (for single-node mode and error handling)
    if (this.pendingElicit) {
      clearTimeout(this.pendingElicit.timeoutHandle);
      this.pendingElicit.resolve(result);
      this.pendingElicit = undefined;
    }

    return true;
  }

  /**
   * Async handler for elicit result - uses ElicitationResultFlow for processing.
   * Called from handleIfElicitResult without awaiting to avoid blocking the response.
   */
  private async handleElicitResultAsync(sessionId: string, mcpResult: McpElicitResult): Promise<void> {
    try {
      // Run the flow for hook support and distributed routing
      const output = await this.scope.runFlow('elicitation:result', {
        sessionId,
        result: mcpResult,
      });

      if (output?.handled) {
        this.logger.verbose('ElicitationResultFlow handled result', {
          elicitId: output.elicitId,
          sessionId: sessionId.slice(0, 20),
          status: output.result?.status,
        });
      }
    } catch (error) {
      this.logger.warn('Failed to run ElicitationResultFlow', {
        sessionId: sessionId.slice(0, 20),
        error: (error as Error).message,
      });
    }
  }

  /**
   * Type predicate to check if an app configuration represents a remote MCP app.
   * Remote apps have a 'urlType' property and are not standalone.
   */
  private isRemoteApp(app: unknown): boolean {
    if (app === null || typeof app !== 'object') return false;
    const appObj = app as Record<string, unknown>;
    // Remote apps have 'urlType' property indicating they're external MCP servers
    // Standalone apps don't contribute to the main server's capabilities
    return 'urlType' in appObj && appObj['standalone'] !== true;
  }

  /**
   * Build capabilities that should be pre-advertised for remote apps.
   * Remote apps load their tools/resources/prompts asynchronously after connection,
   * so we need to pre-advertise listChanged capabilities for proper notification support.
   */
  private buildRemoteCapabilities(): Record<string, unknown> {
    return {
      tools: { listChanged: true },
      resources: { subscribe: true, listChanged: true },
      prompts: { listChanged: true },
    };
  }
}
