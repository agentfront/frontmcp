// errors/error-handler.ts
import { FlowControl } from '../common';
import { McpError, formatMcpErrorResponse, toMcpError } from './mcp.error';

export interface ErrorHandlerOptions {
  /**
   * Whether to include stack traces in error responses
   */
  isDevelopment?: boolean;

  /**
   * Logger function for error logging
   */
  logger?: {
    error: (message: string, meta?: any) => void;
    warn: (message: string, meta?: any) => void;
  };

  /**
   * Custom error transformer
   */
  errorTransformer?: (error: any) => any;
}

/**
 * Handle errors in MCP flows and format them appropriately
 */
export class ErrorHandler {
  private isDevelopment: boolean;
  private logger?: ErrorHandlerOptions['logger'];
  private errorTransformer?: ErrorHandlerOptions['errorTransformer'];

  constructor(options: ErrorHandlerOptions = {}) {
    this.isDevelopment = options.isDevelopment ?? process.env['NODE_ENV'] !== 'production';
    this['logger'] = options.logger;
    this.errorTransformer = options.errorTransformer;
  }

  /**
   * Handle an error and return a formatted MCP response
   */
  handle(error: any, context?: { flowName?: string; toolName?: string }) {
    // Transform error if transformer is provided
    const transformedError = this.errorTransformer ? this.errorTransformer(error) : error;

    // Log the error
    this.logError(transformedError, context);

    // Format for MCP response
    return formatMcpErrorResponse(transformedError, this.isDevelopment);
  }

  /**
   * Log error with appropriate level
   */
  private logError(error: any, context?: { flowName?: string; toolName?: string }) {
    if (!this.logger) return;

    const meta = {
      ...context,
      errorId: error instanceof McpError ? error.errorId : undefined,
      code: error instanceof McpError ? error.code : undefined,
      stack: this.isDevelopment ? error.stack : undefined,
    };

    if (error instanceof McpError) {
      if (error.isPublic) {
        this.logger.warn(`Public error: ${error.getInternalMessage()}`, meta);
      } else {
        this.logger.error(`Internal error: ${error.getInternalMessage()}`, meta);
      }
    } else {
      this.logger.error(`Unexpected error: ${error.message || String(error)}`, meta);
    }
  }

  /**
   * Wrap a function with error handling
   */
  wrap<T extends (...args: any[]) => any>(fn: T): T {
    return ((...args: any[]) => {
      try {
        const result = fn(...args);
        if (result instanceof Promise) {
          return result.catch((error) => {
            throw this.transformToMcpError(error);
          });
        }
        return result;
      } catch (error) {
        throw this.transformToMcpError(error);
      }
    }) as T;
  }

  /**
   * Transform any error to MCP error
   */
  private transformToMcpError(error: any): McpError {
    if (error instanceof McpError) {
      return error;
    }

    if (this.errorTransformer) {
      const transformed = this.errorTransformer(error);
      if (transformed instanceof McpError) {
        return transformed;
      }
    }

    return toMcpError(error);
  }
}

/**
 * Create a global error handler instance
 */
export function createErrorHandler(options: ErrorHandlerOptions = {}): ErrorHandler {
  return new ErrorHandler(options);
}

/**
 * Helper to check if an error should stop execution
 */
export function shouldStopExecution(error: any): boolean {
  if (error instanceof FlowControl) {
    return ['fail', 'abort'].includes(error.type);
  }
  return true;
}
