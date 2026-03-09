import { FrontMcpServer, HttpMethod, ServerRequestHandler } from '../common';

/**
 * No-op server implementation for CLI mode.
 * Avoids importing Express/CORS and creating HTTP infrastructure
 * that's never used during CLI tool execution.
 */
export class NoopFrontMcpServer extends FrontMcpServer {
  registerMiddleware(_entryPath: string, _handler: ServerRequestHandler): void {
    // noop
  }

  registerRoute(_method: HttpMethod, _path: string, _handler: ServerRequestHandler): void {
    // noop
  }

  override enhancedHandler(handler: ServerRequestHandler): ServerRequestHandler {
    return handler;
  }

  prepare(): void {
    // noop
  }

  getHandler(): unknown {
    return undefined;
  }

  async start(): Promise<void> {
    // noop
  }
}
