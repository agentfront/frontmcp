import { InternalMcpError, MCP_ERROR_CODES, PublicMcpError } from './mcp.error';

/** A lazy app that cannot start: an invalid config, an app that cannot be lazy, or no manifest in production. */
export class LazyAppConfigurationError extends InternalMcpError {
  constructor(message: string) {
    super(message, 'LAZY_APP_CONFIGURATION_ERROR');
  }
}

/**
 * A call to an entry of a lazy app whose code failed to import or initialize. The server keeps serving; when
 * `retryable`, the next call imports the app again.
 */
export class LazyAppLoadError extends PublicMcpError {
  readonly mcpErrorCode = MCP_ERROR_CODES.INTERNAL_ERROR;

  constructor(
    readonly appName: string,
    readonly retryable: boolean,
  ) {
    super(`App "${appName}" could not be loaded`, 'LAZY_APP_LOAD_FAILED', 503, undefined, {
      say: retryable
        ? 'Call it again: the server imports the app again on the next call. If it keeps failing, the server log says why.'
        : `Ask the server's operator to fix app "${appName}" (the server log says why) and restart the server.`,
    });
  }

  toJsonRpcError() {
    return {
      code: this.mcpErrorCode,
      message: this.getPublicMessage(),
      data: { code: this.code, status: this.statusCode, app: this.appName, retryable: this.retryable },
    };
  }
}
