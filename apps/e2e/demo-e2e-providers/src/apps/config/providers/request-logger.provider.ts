import { AsyncProvider, ProviderScope, FRONTMCP_CONTEXT, FrontMcpContext } from '@frontmcp/sdk';

/**
 * Token for the RequestLoggerProvider
 */
export const REQUEST_LOGGER_TOKEN = Symbol('REQUEST_LOGGER');

/**
 * Request logger interface
 */
export interface RequestLogger {
  requestId: string;
  sessionId: string;
  createdAt: Date;
  instanceId: string;
  log(message: string): void;
  getInfo(): RequestLoggerInfo;
}

export interface RequestLoggerInfo {
  requestId: string;
  sessionId: string;
  createdAt: string;
  instanceId: string;
  logs: string[];
}

/**
 * Implementation class for RequestLogger
 */
class RequestLoggerImpl implements RequestLogger {
  readonly createdAt = new Date();
  readonly instanceId = `req-${Math.random().toString(36).substring(2, 10)}`;
  private logs: string[] = [];

  constructor(readonly requestId: string, readonly sessionId: string) {}

  log(message: string): void {
    this.logs.push(`[${new Date().toISOString()}] ${message}`);
  }

  getInfo(): RequestLoggerInfo {
    return {
      requestId: this.requestId,
      sessionId: this.sessionId,
      createdAt: this.createdAt.toISOString(),
      instanceId: this.instanceId,
      logs: [...this.logs],
    };
  }
}

/**
 * CONTEXT scope provider - new instance created per request.
 * Demonstrates AsyncProvider factory pattern with dependency injection.
 */
export const RequestLoggerProvider = AsyncProvider({
  name: 'RequestLoggerProvider',
  provide: REQUEST_LOGGER_TOKEN,
  scope: ProviderScope.CONTEXT,
  inject: () => [FRONTMCP_CONTEXT] as const,
  useFactory: async (ctx): Promise<RequestLogger> => {
    const frontMcpContext = ctx as FrontMcpContext;
    const requestId = frontMcpContext.requestId || 'unknown';
    const sessionId = frontMcpContext.sessionId || 'unknown';
    return new RequestLoggerImpl(requestId, sessionId);
  },
});
