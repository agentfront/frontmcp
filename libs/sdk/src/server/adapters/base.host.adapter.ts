import { FrontMcpServer } from '../../common';

export abstract class HostServerAdapter extends FrontMcpServer {
  /**
   * Prepares the server routes without starting the HTTP listener.
   * Used for serverless deployments (Vercel, AWS Lambda, etc.)
   */
  abstract override prepare(): void;

  /**
   * Returns the underlying HTTP handler for serverless exports.
   */
  abstract override getHandler(): unknown;

  /**
   * Start the server on the specified port or Unix socket path.
   * When a string is provided, the server listens on a Unix socket.
   * When a number is provided, the server listens on a TCP port.
   *
   * @param portOrSocketPath - Port number or Unix socket path
   * @param bindAddress - Optional bind address (e.g., '127.0.0.1', '0.0.0.0')
   */
  abstract override start(portOrSocketPath: number | string, bindAddress?: string): Promise<void> | void;
}
