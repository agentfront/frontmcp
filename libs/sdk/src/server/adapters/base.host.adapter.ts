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
   */
  abstract override start(portOrSocketPath: number | string): Promise<void> | void;
}
