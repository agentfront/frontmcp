import { AsyncProvider, ProviderScope } from '@frontmcp/sdk';
import { randomBytes } from '@frontmcp/utils';

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
/**
 * Generate a cryptographically secure random ID.
 */
function generateSecureId(prefix: string, bytes = 6): string {
  return `${prefix}-${Buffer.from(randomBytes(bytes)).toString('hex')}`;
}

class RequestLoggerImpl implements RequestLogger {
  readonly createdAt = new Date();
  readonly instanceId = generateSecureId('req');
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
 * Demonstrates AsyncProvider factory pattern.
 *
 * Note: We don't inject FRONTMCP_CONTEXT here since it's not available at
 * initialization time. Instead, the tool using this provider will have access
 * to context through its scope.
 */
export const RequestLoggerProvider = AsyncProvider({
  name: 'RequestLoggerProvider',
  provide: REQUEST_LOGGER_TOKEN,
  scope: ProviderScope.CONTEXT,
  inject: () => [] as const,
  useFactory: async (): Promise<RequestLogger> => {
    // Generate unique IDs for this request instance using cryptographically secure randomness
    // In a real implementation, this would receive context from the tool
    const requestId = `req-${Date.now()}-${Buffer.from(randomBytes(4)).toString('hex')}`;
    const sessionId = generateSecureId('sess');
    return new RequestLoggerImpl(requestId, sessionId);
  },
});
