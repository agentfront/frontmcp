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
  constructor(options: StreamableHTTPServerTransportOptions = {}) {
    super(options);
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
   * Sets the transport to an initialized state with the given session ID.
   * Use this when recreating a transport from a stored session.
   *
   * This method allows you to "restore" a session without replaying the
   * initialization handshake. After calling this method, the transport
   * will accept requests with the given session ID.
   *
   * @param sessionId - The session ID that was previously assigned to this session
   * @throws Error if sessionId is empty or invalid
   */
  setInitializationState(sessionId: string): void {
    // Validate sessionId
    if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
      throw new Error('[RecreateableStreamableHTTPServerTransport] sessionId cannot be empty');
    }

    // Access the internal WebStandardTransport and set both flags
    // Note: This accesses MCP SDK internals which may change between versions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const webTransport = (this as any)._webStandardTransport;
    if (!webTransport) {
      console.warn(
        '[RecreateableStreamableHTTPServerTransport] Internal transport not found. ' +
          'This may indicate an incompatible MCP SDK version.',
      );
      return;
    }

    // Verify expected fields exist before setting (SDK version safety)
    if (!('_initialized' in webTransport) || !('sessionId' in webTransport)) {
      console.warn(
        '[RecreateableStreamableHTTPServerTransport] Expected fields not found on internal transport. ' +
          'This may indicate an incompatible MCP SDK version.',
      );
      return;
    }

    webTransport._initialized = true;
    webTransport.sessionId = sessionId;
  }
}
