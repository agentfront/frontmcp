/**
 * Custom StreamableHTTPServerTransport that supports session recreation.
 *
 * The MCP SDK's transport sets `_initialized` and `sessionId` only during
 * the initialize request handshake. When recreating a transport from Redis
 * (e.g., in serverless environments), we need to set these values directly.
 *
 * This class extends the MCP SDK's transport to expose a public API for
 * session recreation, avoiding the need to access private properties.
 */
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

export interface StreamableHTTPServerTransportOptions {
  /**
   * A function that generates a session ID for the transport.
   * If provided, sessions are stateful and require the mcp-session-id header.
   * If undefined, the transport operates in stateless mode.
   */
  sessionIdGenerator?: () => string;

  /**
   * If true, responses are sent as JSON instead of SSE.
   * Default: false (SSE streaming mode)
   */
  enableJsonResponse?: boolean;

  /**
   * Event store for resumability support.
   * Type uses `any` because the EventStore interface is not exported from the MCP SDK
   * and varies between SDK versions. The actual type is defined internally by
   * StreamableHTTPServerTransport.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eventStore?: any;

  /**
   * Callback when a session is initialized.
   */
  onsessioninitialized?: (sessionId: string) => void | Promise<void>;

  /**
   * Callback when a session is closed.
   */
  onsessionclosed?: (sessionId?: string) => void | Promise<void>;
}

/**
 * StreamableHTTPServerTransport with session recreation support.
 *
 * This is a drop-in replacement for the MCP SDK's StreamableHTTPServerTransport
 * that adds the ability to recreate a session without replaying the initialization
 * handshake. This is essential for serverless environments where the transport
 * may be evicted from memory and needs to be recreated from a stored session.
 *
 * It extends StreamableHTTPServerTransport to maintain full compatibility while
 * adding public methods to set initialization state.
 */
export class RecreateableStreamableHTTPServerTransport extends StreamableHTTPServerTransport {
  /**
   * Stores pending initialization state when setInitializationState is called
   * before _webStandardTransport is ready. Applied on first handleRequest.
   */
  private _pendingInitState?: string;

  /**
   * Stored constructor options for recreating internal transports.
   * MCP SDK 1.26.0 enforces single-use for stateless transports,
   * so we need to create fresh instances for each request.
   */
  private readonly _constructorOptions: StreamableHTTPServerTransportOptions;

  constructor(options: StreamableHTTPServerTransportOptions = {}) {
    super(options);
    this._constructorOptions = options;
  }

  /**
   * Returns whether the transport has been initialized.
   */
  get isInitialized(): boolean {
    // Access internal MCP SDK property - may change between SDK versions.
    // Uses optional chaining with fallback for safety.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any)._webStandardTransport?._initialized ?? false;
  }

  /**
   * Returns whether there's a pending initialization state waiting to be applied.
   * This is true when setInitializationState was called before _webStandardTransport existed.
   */
  get hasPendingInitState(): boolean {
    return this._pendingInitState !== undefined;
  }

  /**
   * Sets the transport to an initialized state with the given session ID.
   * Use this when recreating a transport from a stored session.
   *
   * This method allows you to "restore" a session without replaying the
   * initialization handshake. After calling this method, the transport
   * will accept requests with the given session ID.
   *
   * If the internal transport is not ready yet (common in serverless cold starts),
   * the state is stored and applied on the first handleRequest call.
   *
   * @param sessionId - The session ID that was previously assigned to this session
   * @throws Error if sessionId is empty or invalid
   */
  setInitializationState(sessionId: string): void {
    // Validate sessionId
    if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
      throw new Error('[RecreateableStreamableHTTPServerTransport] sessionId cannot be empty');
    }

    // Access the internal WebStandardTransport
    // Note: This accesses MCP SDK internals which may change between versions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const webTransport = (this as any)._webStandardTransport;
    if (!webTransport) {
      // Transport not ready yet - store for deferred application
      // This happens during serverless cold starts when recreation occurs
      // before the first request is processed
      this._pendingInitState = sessionId;
      return;
    }

    this._applyInitState(webTransport, sessionId);
  }

  /**
   * Applies initialization state to the internal transport.
   * @param webTransport - The internal _webStandardTransport object
   * @param sessionId - The session ID to set
   * @throws Error if the MCP SDK version is incompatible
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _applyInitState(webTransport: any, sessionId: string): void {
    // Verify _initialized field exists (SDK version safety check)
    // Note: sessionId is only assigned during initialization request processing,
    // so it won't exist on a fresh transport - we're about to set it.
    if (!('_initialized' in webTransport)) {
      throw new Error(
        '[RecreateableStreamableHTTPServerTransport] Expected _initialized field not found on internal transport. ' +
          'This may indicate an incompatible MCP SDK version.',
      );
    }

    webTransport._initialized = true;
    webTransport.sessionId = sessionId;
  }

  /**
   * Override handleRequest to:
   * 1. Recreate the internal transport for stateless mode (MCP SDK 1.26.0 single-use guard)
   * 2. Apply any pending initialization state before processing
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async handleRequest(req: any, res: any, body?: any): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const oldWebTransport = (this as any)._webStandardTransport;

    // MCP SDK 1.26.0 enforces single-use for stateless transports (no sessionIdGenerator).
    // FrontMCP manages its own session lifecycle and reuses the adapter across requests.
    // Create a fresh WebStandardStreamableHTTPServerTransport for each subsequent stateless
    // request to align with the SDK's intended per-request transport lifecycle.
    if (oldWebTransport && !oldWebTransport.sessionIdGenerator && oldWebTransport._hasHandledRequest) {
      const fresh = new WebStandardStreamableHTTPServerTransport(this._constructorOptions);
      // Transfer MCP Server connection handlers to the fresh transport
      fresh.onmessage = oldWebTransport.onmessage;
      fresh.onclose = oldWebTransport.onclose;
      fresh.onerror = oldWebTransport.onerror;
      await fresh.start();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any)._webStandardTransport = fresh;
    }

    // Apply deferred initialization state before processing request
    if (this._pendingInitState) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const webTransport = (this as any)._webStandardTransport;
      if (webTransport) {
        this._applyInitState(webTransport, this._pendingInitState);
        this._pendingInitState = undefined;
      }
    }
    return super.handleRequest(req, res, body);
  }
}
