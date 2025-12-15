/**
 * Context Module
 *
 * Provides unified context management for production-ready request handling.
 *
 * Key exports:
 * - FrontMcpContext (alias: Context): Unified context with session + request data
 * - FrontMcpContextStorage: AsyncLocalStorage wrapper for context propagation
 * - FRONTMCP_CONTEXT: DI token for accessing current context
 * - TraceContext utilities: W3C Trace Context parsing and generation
 *
 * @deprecated exports (backward compatibility):
 * - RequestContext: Use FrontMcpContext instead
 * - RequestContextStorage: Use FrontMcpContextStorage instead
 * - REQUEST_CONTEXT: Use FRONTMCP_CONTEXT instead
 * - SessionKey: No longer needed with unified context
 */

// =====================
// New Unified Context (Primary exports)
// =====================

// FrontMcpContext - unified context class
export {
  FrontMcpContext,
  Context, // Short alias
  FrontMcpContextArgs,
  FrontMcpContextConfig,
  RequestMetadata,
  TransportAccessor,
} from './frontmcp-context';

// FrontMcpContextStorage - AsyncLocalStorage wrapper
export { FrontMcpContextStorage, ContextStorage } from './frontmcp-context-storage';

// DI token and provider
export {
  FRONTMCP_CONTEXT,
  FrontMcpContextProvider,
  // Backward compatibility
  REQUEST_CONTEXT,
  RequestContextProvider,
} from './frontmcp-context.provider';

// =====================
// Trace Context (unchanged)
// =====================

export { TraceContext, parseTraceContext, generateTraceContext, createChildSpanContext } from './trace-context';

// =====================
// Backward Compatibility (deprecated)
// =====================

/**
 * @deprecated Use FrontMcpContext instead
 */
export { RequestContext, RequestContextArgs as LegacyRequestContextArgs } from './request-context';

/**
 * @deprecated Use FrontMcpContextStorage instead
 */
export { RequestContextStorage } from './request-context-storage';

/**
 * @deprecated SessionKey is no longer needed. Use ctx.sessionId directly.
 */
export { SessionKey } from './session-key.provider';
