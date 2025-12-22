/**
 * MCP Bridge Runtime Module
 *
 * Provides the infrastructure for rendering tool UI templates
 * that work across multiple host environments (OpenAI, Claude, ext-apps).
 *
 * @module @frontmcp/ui/runtime
 */
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
  UIContentSecurityPolicy,
  TemplateContext,
  TemplateHelpers,
  TemplateBuilderFn,
  ToolUITemplate,
  ToolUIConfig,
  WidgetServingMode,
} from './types';
export { MCP_BRIDGE_RUNTIME, getMCPBridgeScript, isMCPBridgeSupported } from './mcp-bridge';
export {
  FRONTMCP_BRIDGE_RUNTIME,
  PLATFORM_BRIDGE_SCRIPTS,
  generateCustomBridge,
  type IIFEGeneratorOptions,
} from './mcp-bridge';
export {
  DEFAULT_CDN_DOMAINS,
  DEFAULT_CSP_DIRECTIVES,
  RESTRICTIVE_CSP_DIRECTIVES,
  buildCSPDirectives,
  buildCSPMetaTag,
  buildOpenAICSP,
  validateCSPDomain,
  sanitizeCSPDomains,
} from './csp';
export {
  type WrapToolUIFullOptions,
  type WrapToolUIUniversalOptions,
  type WrapStaticWidgetOptions,
  type WrapLeanWidgetShellOptions,
  type WrapHybridWidgetShellOptions,
  type WrapToolUIForClaudeOptions,
  wrapToolUI,
  wrapToolUIMinimal,
  wrapToolUIUniversal,
  wrapStaticWidgetUniversal,
  wrapLeanWidgetShell,
  wrapHybridWidgetShell,
  wrapToolUIForClaude,
  createTemplateHelpers,
  buildOpenAIMeta,
  getToolUIMimeType,
} from './wrapper';
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
export {
  RendererRuntime,
  createRendererRuntime,
  bootstrapRendererRuntime,
  generateBootstrapScript,
  type RendererRuntimeConfig,
} from './renderer-runtime';
export {
  type RendererAdapter,
  type RenderContext,
  type RenderOptions,
  type RenderResult,
  type AdapterLoader,
  HtmlRendererAdapter,
  MdxRendererAdapter,
  createHtmlAdapter,
  createMdxAdapter,
  loadAdapter,
  getAdapterLoader,
  adapterLoaders,
} from './adapters';
//# sourceMappingURL=index.d.ts.map
