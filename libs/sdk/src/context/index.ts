/**
 * Context Module
 *
 * Provides request-scoped context management for production-ready request handling.
 *
 * Key exports:
 * - RequestContext: Rich context object with requestId, traceId, authInfo, etc.
 * - RequestContextStorage: AsyncLocalStorage wrapper for context propagation
 * - REQUEST_CONTEXT: DI token for accessing current RequestContext
 * - TraceContext utilities: W3C Trace Context parsing and generation
 */

// Trace context types and utilities
export { TraceContext, parseTraceContext, generateTraceContext, createChildSpanContext } from './trace-context';

// Request context types and class
export { RequestContext, RequestContextArgs, RequestMetadata } from './request-context';

// AsyncLocalStorage wrapper
export { RequestContextStorage } from './request-context-storage';

// DI provider and token
export { REQUEST_CONTEXT, RequestContextProvider } from './request-context.provider';

// Session key class for SESSION-scoped providers
export { SessionKey } from './session-key.provider';
