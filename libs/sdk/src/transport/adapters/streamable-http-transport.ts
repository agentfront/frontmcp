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
import type { ServerResponse } from 'http';
import type { JSONRPCMessage, RequestId } from '@modelcontextprotocol/sdk/types.js';
import type { AuthenticatedServerRequest } from '../../server/server.types';

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
   * Uses any to avoid complex type extraction from MCP SDK's optional options type.
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
  private _preInitializedSessionId: string | undefined;

  constructor(options: StreamableHTTPServerTransportOptions = {}) {
    super(options);
  }

  /**
   * Returns whether the transport has been initialized.
   */
  get isInitialized(): boolean {
    // Access the internal WebStandardTransport's _initialized flag
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
   */
  setInitializationState(sessionId: string): void {
    this._preInitializedSessionId = sessionId;

    // Access the internal WebStandardTransport and set both flags
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const webTransport = (this as any)._webStandardTransport;
    if (webTransport) {
      webTransport._initialized = true;
      webTransport.sessionId = sessionId;
    }
  }

  /**
   * Override handleRequest to handle session recreation scenario.
   * When we've set initialization state manually, we need to ensure
   * the transport operates correctly.
   */
  override async handleRequest(
    req: AuthenticatedServerRequest,
    res: ServerResponse,
    parsedBody?: unknown,
  ): Promise<void> {
    return super.handleRequest(req, res, parsedBody);
  }

  /**
   * Sends a JSON-RPC message through the transport.
   */
  override async send(message: JSONRPCMessage, options?: { relatedRequestId?: RequestId }): Promise<void> {
    return super.send(message, options);
  }
}
