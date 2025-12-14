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
   *  Start the server on the specified port
   */
  abstract override start(port: number): Promise<void> | void;
}
