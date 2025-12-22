/**
 * MCP Bridge Runtime
 *
 * Universal JavaScript runtime injected into UI templates that adapts
 * to the host environment (OpenAI Apps SDK, ext-apps, Claude, etc.).
 *
 * This script is designed to be embedded directly into HTML templates
 * via the MCP_BRIDGE_RUNTIME constant.
 *
 * Architecture:
 * - On OpenAI: Proxy directly to native window.openai API
 * - On Claude: Polyfill with limited functionality (network-blocked)
 * - On ext-apps: JSON-RPC postMessage bridge (SEP-1865 compliant)
 * - On Gemini: Gemini SDK integration
 * - On Unknown: LocalStorage-based state, basic functionality
 *
 * @see https://developers.openai.com/apps-sdk/build/chatgpt-ui
 * @see https://github.com/modelcontextprotocol/ext-apps (SEP-1865)
 */
/**
 * The MCP Bridge runtime script.
 * This is injected into UI templates to provide a unified API across providers.
 *
 * Uses the new FrontMcpBridge adapter system which supports:
 * - OpenAI ChatGPT Apps SDK
 * - ext-apps (SEP-1865 protocol)
 * - Claude (Anthropic)
 * - Gemini (Google)
 * - Generic fallback
 *
 * The bridge exposes:
 * - window.FrontMcpBridge - New unified bridge API
 * - window.mcpBridge - Legacy compatibility bridge
 * - window.openai - OpenAI polyfill for non-OpenAI platforms
 *
 * Provides full OpenAI window.openai API compatibility:
 * - Properties: theme, userAgent, locale, maxHeight, displayMode, safeArea,
 *               toolInput, toolOutput, toolResponseMetadata, widgetState
 * - Methods: callTool, requestDisplayMode, requestClose, openExternal,
 *            sendFollowUpMessage, setWidgetState
 */
export declare const MCP_BRIDGE_RUNTIME =
  "\n<script>\n(function() {\n  'use strict';\n\n  // ==================== Environment Detection ====================\n\n  var isOpenAI = typeof window.openai !== 'undefined';\n  var isExtApps = window.parent !== window && !isOpenAI;\n  var isClaude = typeof window.claude !== 'undefined' ||\n    (window.__mcpPlatform === 'claude');\n  var isGemini = window.__mcpPlatform === 'gemini';\n\n  // ==================== Internal State ====================\n\n  var messageId = 0;\n  var pendingRequests = new Map();\n  var contextChangeListeners = [];\n  var toolResultListeners = [];\n\n  // Default values for polyfilled properties\n  var defaultSafeArea = { top: 0, bottom: 0, left: 0, right: 0 };\n  var defaultUserAgent = { type: 'web', hover: true, touch: false };\n\n  // Host context (for ext-apps and polyfill mode)\n  var hostContext = window.__mcpHostContext || {\n    theme: 'light',\n    displayMode: 'inline'\n  };\n\n  // Trusted origin for postMessage validation (set during ext-apps initialization)\n  var trustedOrigin = null;\n\n  // Detect device capabilities\n  var detectUserAgent = function() {\n    var ua = navigator.userAgent || '';\n    var isMobile = /iPhone|iPad|iPod|Android/i.test(ua);\n    var hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;\n    var hasHover = window.matchMedia && window.matchMedia('(hover: hover)').matches;\n    return {\n      type: isMobile ? 'mobile' : 'web',\n      hover: hasHover !== false,\n      touch: hasTouch\n    };\n  };\n\n  // Detect theme from system preference\n  var detectTheme = function() {\n    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {\n      return 'dark';\n    }\n    return 'light';\n  };\n\n  // ==================== Bridge Implementation ====================\n\n  /**\n   * MCP Bridge provides full OpenAI API compatibility.\n   * On OpenAI, it proxies directly to window.openai.\n   * On other platforms, it provides polyfills.\n   */\n  var bridge = {\n    // ==================== Environment Info ====================\n\n    get provider() {\n      if (isOpenAI) return 'openai';\n      if (isClaude) return 'claude';\n      if (isGemini) return 'gemini';\n      if (isExtApps) return 'ext-apps';\n      return 'unknown';\n    },\n\n    // ==================== OpenAI-Compatible Properties ====================\n\n    get theme() {\n      if (isOpenAI && window.openai) {\n        return window.openai.theme || 'light';\n      }\n      return hostContext.theme || detectTheme();\n    },\n\n    get userAgent() {\n      if (isOpenAI && window.openai && window.openai.userAgent) {\n        return window.openai.userAgent;\n      }\n      return hostContext.userAgent || detectUserAgent();\n    },\n\n    get locale() {\n      if (isOpenAI && window.openai && window.openai.locale) {\n        return window.openai.locale;\n      }\n      return navigator.language || 'en-US';\n    },\n\n    get maxHeight() {\n      if (isOpenAI && window.openai) {\n        return window.openai.maxHeight;\n      }\n      return hostContext.viewport ? hostContext.viewport.maxHeight : undefined;\n    },\n\n    get displayMode() {\n      if (isOpenAI && window.openai) {\n        return window.openai.displayMode || 'inline';\n      }\n      return hostContext.displayMode || 'inline';\n    },\n\n    get safeArea() {\n      if (isOpenAI && window.openai && window.openai.safeArea) {\n        return window.openai.safeArea;\n      }\n      return hostContext.safeArea || defaultSafeArea;\n    },\n\n    get toolInput() {\n      if (isOpenAI && window.openai && window.openai.toolInput) {\n        return window.openai.toolInput;\n      }\n      return window.__mcpToolInput || {};\n    },\n\n    get toolOutput() {\n      if (isOpenAI && window.openai) {\n        return window.openai.toolOutput;\n      }\n      return window.__mcpToolOutput;\n    },\n\n    get structuredContent() {\n      // Alias for toolOutput to maintain compatibility\n      if (isOpenAI && window.openai) {\n        return window.openai.toolOutput;\n      }\n      return window.__mcpStructuredContent;\n    },\n\n    get toolResponseMetadata() {\n      if (isOpenAI && window.openai && window.openai.toolResponseMetadata) {\n        return window.openai.toolResponseMetadata;\n      }\n      return window.__mcpToolResponseMetadata || {};\n    },\n\n    get widgetState() {\n      if (isOpenAI && window.openai) {\n        return window.openai.widgetState || {};\n      }\n      // Polyfill: use localStorage\n      try {\n        var stored = localStorage.getItem('__mcpWidgetState');\n        return stored ? JSON.parse(stored) : {};\n      } catch (e) {\n        return {};\n      }\n    },\n\n    // ==================== OpenAI-Compatible Methods ====================\n\n    callTool: function(name, params) {\n      if (isOpenAI && window.openai && window.openai.callTool) {\n        return window.openai.callTool(name, params);\n      }\n      if (isClaude) {\n        return Promise.reject(new Error(\n          'Tool calls are not supported in Claude widgets (network-blocked sandbox)'\n        ));\n      }\n      if (isGemini) {\n        return Promise.reject(new Error(\n          'Tool calls are not supported in Gemini widgets'\n        ));\n      }\n      if (isExtApps) {\n        return this._sendRequest('tools/call', { name: name, arguments: params });\n      }\n      return Promise.reject(new Error('Tool calls not supported in this environment'));\n    },\n\n    requestDisplayMode: function(options) {\n      if (isOpenAI && window.openai && window.openai.requestDisplayMode) {\n        return window.openai.requestDisplayMode(options);\n      }\n      if (isExtApps) {\n        return this._sendRequest('ui/request-display-mode', options);\n      }\n      // Polyfill: just update local state\n      if (options && options.mode) {\n        hostContext.displayMode = options.mode;\n        contextChangeListeners.forEach(function(cb) {\n          try { cb({ displayMode: options.mode }); } catch (e) {}\n        });\n      }\n      return Promise.resolve();\n    },\n\n    requestClose: function() {\n      if (isOpenAI && window.openai && window.openai.requestClose) {\n        return window.openai.requestClose();\n      }\n      if (isExtApps) {\n        return this._sendRequest('ui/request-close', {});\n      }\n      // Polyfill: dispatch event for parent to handle\n      window.dispatchEvent(new CustomEvent('mcp:request-close'));\n      return Promise.resolve();\n    },\n\n    openExternal: function(options) {\n      var href = typeof options === 'string' ? options : (options && options.href);\n      if (!href) {\n        return Promise.reject(new Error('URL required'));\n      }\n      if (isOpenAI && window.openai && window.openai.openExternal) {\n        return window.openai.openExternal({ href: href });\n      }\n      if (isExtApps) {\n        return this._sendRequest('ui/open-link', { url: href });\n      }\n      // Fallback: open in new window\n      window.open(href, '_blank', 'noopener,noreferrer');\n      return Promise.resolve();\n    },\n\n    // Alias for openExternal (backwards compatibility)\n    openLink: function(url) {\n      return this.openExternal({ href: url });\n    },\n\n    sendFollowUpMessage: function(options) {\n      var prompt = typeof options === 'string' ? options : (options && options.prompt);\n      if (!prompt) {\n        return Promise.reject(new Error('Prompt required'));\n      }\n      if (isOpenAI && window.openai && window.openai.sendFollowUpMessage) {\n        return window.openai.sendFollowUpMessage({ prompt: prompt });\n      }\n      if (isClaude) {\n        return Promise.reject(new Error(\n          'Follow-up messages are not supported in Claude widgets (network-blocked sandbox)'\n        ));\n      }\n      if (isGemini) {\n        return Promise.reject(new Error(\n          'Follow-up messages are not supported in Gemini widgets'\n        ));\n      }\n      if (isExtApps) {\n        return this._sendRequest('ui/message', {\n          role: 'user',\n          content: { type: 'text', text: prompt }\n        });\n      }\n      return Promise.reject(new Error('Messages not supported in this environment'));\n    },\n\n    // Alias for sendFollowUpMessage (backwards compatibility)\n    sendMessage: function(content) {\n      return this.sendFollowUpMessage({ prompt: content });\n    },\n\n    setWidgetState: function(state) {\n      if (isOpenAI && window.openai && window.openai.setWidgetState) {\n        window.openai.setWidgetState(state);\n        return;\n      }\n      // Polyfill: persist to localStorage\n      try {\n        localStorage.setItem('__mcpWidgetState', JSON.stringify(state));\n      } catch (e) {\n        console.warn('Failed to persist widget state:', e);\n      }\n    },\n\n    // ==================== Context API (MCP-specific) ====================\n\n    get context() {\n      return {\n        theme: this.theme,\n        displayMode: this.displayMode,\n        viewport: this.maxHeight ? { maxHeight: this.maxHeight } : undefined,\n        userAgent: this.userAgent,\n        locale: this.locale,\n        safeArea: this.safeArea\n      };\n    },\n\n    onContextChange: function(callback) {\n      contextChangeListeners.push(callback);\n      return function() {\n        var index = contextChangeListeners.indexOf(callback);\n        if (index > -1) contextChangeListeners.splice(index, 1);\n      };\n    },\n\n    onToolResult: function(callback) {\n      toolResultListeners.push(callback);\n      return function() {\n        var index = toolResultListeners.indexOf(callback);\n        if (index > -1) toolResultListeners.splice(index, 1);\n      };\n    },\n\n    // ==================== Internal Methods ====================\n\n    _sendRequest: function(method, params) {\n      return new Promise(function(resolve, reject) {\n        var id = ++messageId;\n        pendingRequests.set(id, { resolve: resolve, reject: reject });\n\n        window.parent.postMessage({\n          jsonrpc: '2.0',\n          id: id,\n          method: method,\n          params: params\n        }, '*');\n\n        // Timeout after 30s\n        setTimeout(function() {\n          if (pendingRequests.has(id)) {\n            pendingRequests.delete(id);\n            reject(new Error('Request timeout'));\n          }\n        }, 30000);\n      });\n    },\n\n    _initExtApps: function() {\n      var self = this;\n      return this._sendRequest('ui/initialize', {}).then(function(result) {\n        if (result && result.hostContext) {\n          hostContext = Object.assign(hostContext, result.hostContext);\n        }\n        // Note: trustedOrigin is now set from first message event origin (trust-on-first-use)\n        // Send initialized notification\n        window.parent.postMessage({\n          jsonrpc: '2.0',\n          method: 'ui/notifications/initialized',\n          params: {}\n        }, '*');\n        return result;\n      });\n    }\n  };\n\n  // ==================== Event Handling ====================\n\n  window.addEventListener('message', function(event) {\n    var data = event.data;\n    if (!data || data.jsonrpc !== '2.0') return;\n\n    // Trust-on-first-use: Establish trusted origin from the first valid message\n    if (isExtApps && !trustedOrigin && event.origin) {\n      trustedOrigin = event.origin;\n    }\n\n    // Validate origin for ext-apps environment to prevent spoofed messages\n    if (isExtApps && trustedOrigin && event.origin !== trustedOrigin) {\n      console.warn('MCP Bridge: Ignoring message from untrusted origin:', event.origin);\n      return;\n    }\n\n    // Handle responses\n    if (data.id && pendingRequests.has(data.id)) {\n      var pending = pendingRequests.get(data.id);\n      pendingRequests.delete(data.id);\n\n      if (data.error) {\n        var err = new Error(data.error.message || 'Unknown error');\n        err.code = data.error.code;\n        err.data = data.error.data;\n        pending.reject(err);\n      } else {\n        pending.resolve(data.result);\n      }\n      return;\n    }\n\n    // Handle notifications\n    switch (data.method) {\n      case 'ui/notifications/tool-input':\n        window.__mcpToolInput = data.params && data.params.arguments;\n        window.dispatchEvent(new CustomEvent('mcp:tool-input', { detail: data.params }));\n        break;\n\n      case 'ui/notifications/tool-input-partial':\n        if (data.params && data.params.arguments) {\n          window.__mcpToolInput = Object.assign(window.__mcpToolInput || {}, data.params.arguments);\n        }\n        break;\n\n      case 'ui/notifications/tool-result':\n        window.__mcpToolOutput = data.params && data.params.content;\n        window.__mcpStructuredContent = data.params && data.params.structuredContent;\n        toolResultListeners.forEach(function(cb) {\n          try { cb(data.params); } catch (e) { console.error('Tool result listener error:', e); }\n        });\n        window.dispatchEvent(new CustomEvent('mcp:tool-result', { detail: data.params }));\n        break;\n\n      case 'ui/notifications/tool-cancelled':\n        window.dispatchEvent(new CustomEvent('mcp:tool-cancelled', { detail: data.params }));\n        break;\n\n      case 'ui/host-context-change':\n        hostContext = Object.assign(hostContext, data.params);\n        contextChangeListeners.forEach(function(cb) {\n          try { cb(data.params); } catch (e) { console.error('Context change listener error:', e); }\n        });\n        window.dispatchEvent(new CustomEvent('mcp:context-change', { detail: data.params }));\n        break;\n\n      case 'ui/size-change':\n        if (hostContext.viewport) {\n          hostContext.viewport = Object.assign(hostContext.viewport, data.params);\n        } else {\n          hostContext.viewport = data.params;\n        }\n        break;\n    }\n  });\n\n  // ==================== Initialize ====================\n\n  // Export bridge\n  window.mcpBridge = bridge;\n\n  // Also create window.openai polyfill for non-OpenAI platforms\n  // This allows code written for OpenAI to work on other platforms\n  if (!isOpenAI) {\n    window.openai = {\n      get theme() { return bridge.theme; },\n      get userAgent() { return bridge.userAgent; },\n      get locale() { return bridge.locale; },\n      get maxHeight() { return bridge.maxHeight; },\n      get displayMode() { return bridge.displayMode; },\n      get safeArea() { return bridge.safeArea; },\n      get toolInput() { return bridge.toolInput; },\n      get toolOutput() { return bridge.toolOutput; },\n      get toolResponseMetadata() { return bridge.toolResponseMetadata; },\n      get widgetState() { return bridge.widgetState; },\n      callTool: function(n, a) { return bridge.callTool(n, a); },\n      requestDisplayMode: function(o) { return bridge.requestDisplayMode(o); },\n      requestClose: function() { return bridge.requestClose(); },\n      openExternal: function(o) { return bridge.openExternal(o); },\n      sendFollowUpMessage: function(o) { return bridge.sendFollowUpMessage(o); },\n      setWidgetState: function(s) { return bridge.setWidgetState(s); }\n    };\n  }\n\n  // Auto-initialize for ext-apps\n  if (isExtApps) {\n    bridge._initExtApps().catch(function(err) {\n      console.warn('Failed to initialize MCP bridge:', err);\n    });\n  }\n\n  // Dispatch ready event\n  window.dispatchEvent(new CustomEvent('mcp:bridge-ready'));\n})();\n</script>\n";
/**
 * Get the MCP Bridge runtime script as a string (without script tags)
 * Useful for inline embedding in specific scenarios.
 */
export declare function getMCPBridgeScript(): string;
/**
 * Check if the current environment supports the MCP bridge
 */
export declare function isMCPBridgeSupported(): boolean;
/**
 * The new FrontMcpBridge runtime script (universal - includes all adapters).
 * This is the recommended bridge for new integrations.
 *
 * @example
 * ```typescript
 * import { FRONTMCP_BRIDGE_RUNTIME } from '@frontmcp/ui/runtime';
 * const html = `<!DOCTYPE html><html><head>${FRONTMCP_BRIDGE_RUNTIME}</head>...</html>`;
 * ```
 */
export declare const FRONTMCP_BRIDGE_RUNTIME: string;
/**
 * Platform-specific bridge scripts.
 *
 * Use these for smaller bundle sizes when targeting a specific platform.
 *
 * @example
 * ```typescript
 * import { PLATFORM_BRIDGE_SCRIPTS } from '@frontmcp/ui/runtime';
 *
 * // For ChatGPT only
 * const chatgptHtml = `<html><head>${PLATFORM_BRIDGE_SCRIPTS.chatgpt}</head>...</html>`;
 *
 * // For Claude only
 * const claudeHtml = `<html><head>${PLATFORM_BRIDGE_SCRIPTS.claude}</head>...</html>`;
 * ```
 */
export declare const PLATFORM_BRIDGE_SCRIPTS: {
  universal: string;
  chatgpt: string;
  claude: string;
  gemini: string;
};
/**
 * Generate a custom bridge script with specific options.
 *
 * @example
 * ```typescript
 * import { generateCustomBridge } from '@frontmcp/ui/runtime';
 *
 * const script = generateCustomBridge({
 *   adapters: ['openai', 'ext-apps'],
 *   debug: true,
 *   trustedOrigins: ['https://my-host.com']
 * });
 * ```
 */
export { generateBridgeIIFE as generateCustomBridge } from '../bridge/runtime/iife-generator';
export type { IIFEGeneratorOptions } from '../bridge/runtime/iife-generator';
//# sourceMappingURL=mcp-bridge.d.ts.map
