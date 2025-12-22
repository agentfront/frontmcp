/**
 * FrontMcpBridge - Unified Multi-Platform Adapter System
 *
 * Provides a consistent API for MCP tool widgets across AI platforms:
 * - OpenAI ChatGPT (Apps SDK)
 * - Anthropic Claude
 * - ext-apps (SEP-1865 protocol)
 * - Google Gemini
 * - Generic fallback
 *
 * @example Basic usage
 * ```typescript
 * import { createBridge } from '@frontmcp/ui/bridge';
 *
 * const bridge = await createBridge();
 * const theme = bridge.getTheme();
 * const input = bridge.getToolInput();
 * ```
 *
 * @example Custom adapter registration
 * ```typescript
 * import { AdapterRegistry, FrontMcpBridge, BaseAdapter } from '@frontmcp/ui/bridge';
 *
 * class MyAdapter extends BaseAdapter {
 *   readonly id = 'my-adapter';
 *   readonly name = 'My Custom Adapter';
 *   readonly priority = 50;
 *   canHandle() { return true; }
 * }
 *
 * const registry = new AdapterRegistry();
 * registry.register('my-adapter', () => new MyAdapter());
 *
 * const bridge = new FrontMcpBridge({ forceAdapter: 'my-adapter' }, registry);
 * await bridge.initialize();
 * ```
 *
 * @example Runtime script injection
 * ```typescript
 * import { generateBridgeIIFE, BRIDGE_SCRIPT_TAGS } from '@frontmcp/ui/bridge';
 *
 * // Use pre-generated universal script
 * const html = `<!DOCTYPE html><html>${BRIDGE_SCRIPT_TAGS.universal}...</html>`;
 *
 * // Or generate custom
 * const script = generateBridgeIIFE({ adapters: ['openai', 'generic'], debug: true });
 * ```
 *
 * @packageDocumentation
 */
export type {
  DisplayMode,
  UserAgentInfo,
  SafeAreaInsets,
  ViewportInfo,
  HostContext,
  AdapterCapabilities,
  PlatformAdapter,
  AdapterConfig,
  AdapterFactory,
  AdapterRegistration,
  BridgeConfig,
  FrontMcpBridgeInterface,
  BridgeEventType,
  BridgeEventPayloads,
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  JsonRpcError,
  ExtAppsInitializeParams,
  ExtAppsInitializeResult,
  ExtAppsToolInputParams,
  ExtAppsToolResultParams,
  ExtAppsHostContextChangeParams,
} from './types';
export { AdapterRegistry, defaultRegistry, registerAdapter, getAdapter, detectAdapter } from './core/adapter-registry';
export { FrontMcpBridge, createBridge, getGlobalBridge, resetGlobalBridge } from './core/bridge-factory';
export { BaseAdapter, DEFAULT_CAPABILITIES, DEFAULT_SAFE_AREA } from './adapters/base-adapter';
export { OpenAIAdapter, createOpenAIAdapter } from './adapters/openai.adapter';
export { ExtAppsAdapter, createExtAppsAdapter, type ExtAppsAdapterConfig } from './adapters/ext-apps.adapter';
export { ClaudeAdapter, createClaudeAdapter } from './adapters/claude.adapter';
export { GeminiAdapter, createGeminiAdapter } from './adapters/gemini.adapter';
export { GenericAdapter, createGenericAdapter } from './adapters/generic.adapter';
export { registerBuiltInAdapters } from './adapters';
export {
  generateBridgeIIFE,
  generatePlatformBundle,
  UNIVERSAL_BRIDGE_SCRIPT,
  BRIDGE_SCRIPT_TAGS,
  type IIFEGeneratorOptions,
} from './runtime/iife-generator';
//# sourceMappingURL=index.d.ts.map
