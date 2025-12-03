/**
 * MCP Bridge Runtime Module
 *
 * Provides the infrastructure for rendering tool UI templates
 * that work across multiple host environments (OpenAI, Claude, ext-apps).
 *
 * @module @frontmcp/ui/runtime
 */

// Types (including UI types that were previously re-exported from SDK)
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
  // UI template types (defined locally to avoid circular dependency with SDK)
  UIContentSecurityPolicy,
  TemplateContext,
  TemplateHelpers,
  TemplateBuilderFn,
  ToolUIConfig,
  WidgetServingMode,
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
