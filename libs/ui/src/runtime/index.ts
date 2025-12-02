/**
 * MCP Bridge Runtime Module
 *
 * Provides the infrastructure for rendering tool UI templates
 * that work across multiple host environments (OpenAI, Claude, ext-apps).
 *
 * @module @frontmcp/ui/runtime
 */

// Types
export type {
  ProviderType,
  DisplayMode,
  ThemeMode,
  HostContext,
  MCPBridge,
  MCPBridgeExtended,
  WrapToolUIOptions,
  OpenAIRuntime,
  OpenAIUserAgent,
  SafeAreaInsets,
} from './types';

// Re-export SDK types for convenience
export type {
  UIContentSecurityPolicy,
  TemplateContext,
  TemplateHelpers,
  TemplateBuilderFn,
  ToolUIConfig,
} from './types';

// MCP Bridge Runtime
export { MCP_BRIDGE_RUNTIME, getMCPBridgeScript, isMCPBridgeSupported } from './mcp-bridge';

// CSP utilities
export {
  DEFAULT_CSP_DIRECTIVES,
  buildCSPDirectives,
  buildCSPMetaTag,
  buildOpenAICSP,
  validateCSPDomain,
  sanitizeCSPDomains,
} from './csp';

// Wrapper utilities
export {
  type WrapToolUIFullOptions,
  wrapToolUI,
  wrapToolUIMinimal,
  createTemplateHelpers,
  buildOpenAIMeta,
  getToolUIMimeType,
} from './wrapper';

// Input sanitization
export {
  type SanitizerFn,
  type SanitizeOptions,
  REDACTION_TOKENS,
  PII_PATTERNS,
  sanitizeInput,
  createSanitizer,
  detectPII,
  isEmail,
  isPhone,
  isCreditCard,
  isSSN,
  isIPv4,
  detectPIIType,
  redactPIIFromText,
} from './sanitizer';
