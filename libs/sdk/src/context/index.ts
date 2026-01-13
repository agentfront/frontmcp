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
 * - Session validation: validateSessionId for validating session identifiers
 */

// =====================
// FrontMcpContext - Unified context class
// =====================
export {
  FrontMcpContext,
  Context, // Short alias
  FrontMcpContextArgs,
  FrontMcpContextConfig,
  RequestMetadata,
  TransportAccessor,
  // Session validation
  validateSessionId,
  SESSION_ID_MAX_LENGTH,
  SESSION_ID_VALID_PATTERN,
} from './frontmcp-context';

// =====================
// FrontMcpContextStorage - AsyncLocalStorage wrapper
// =====================
export { FrontMcpContextStorage, ContextStorage } from './frontmcp-context-storage';

// =====================
// DI Token and Provider
// =====================
export { FRONTMCP_CONTEXT, FrontMcpContextProvider } from './frontmcp-context.provider';

// =====================
// Trace Context (W3C compliant)
// =====================
export { TraceContext, parseTraceContext, generateTraceContext, createChildSpanContext } from './trace-context';

// =====================
// Metadata Utilities
// =====================
export { extractMetadata, extractClientIp } from './metadata.utils';

// =====================
// Context Extension (Plugin System)
// =====================
export {
  installContextExtensions,
  isContextExtensionInstalled,
  getInstalledContextExtensions,
} from './context-extension';
