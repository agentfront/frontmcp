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
 * - On ext-apps: JSON-RPC postMessage bridge
 * - On Unknown: LocalStorage-based state, basic functionality
 *
 * @see https://developers.openai.com/apps-sdk/build/chatgpt-ui
 */

import type { ProviderType, ThemeMode, DisplayMode, HostContext } from './types';

/**
 * The MCP Bridge runtime script.
 * This is injected into UI templates to provide a unified API across providers.
 *
 * Provides full OpenAI window.openai API compatibility:
 * - Properties: theme, userAgent, locale, maxHeight, displayMode, safeArea,
 *               toolInput, toolOutput, toolResponseMetadata, widgetState
 * - Methods: callTool, requestDisplayMode, requestClose, openExternal,
 *            sendFollowUpMessage, setWidgetState
 */
export const MCP_BRIDGE_RUNTIME = `
<script>
(function() {
  'use strict';

  // ==================== Environment Detection ====================

  var isOpenAI = typeof window.openai !== 'undefined';
  var isExtApps = window.parent !== window && !isOpenAI;
  var isClaude = typeof window.claude !== 'undefined' ||
    (window.__mcpPlatform === 'claude');
  var isGemini = window.__mcpPlatform === 'gemini';

  // ==================== Internal State ====================

  var messageId = 0;
  var pendingRequests = new Map();
  var contextChangeListeners = [];
  var toolResultListeners = [];

  // Default values for polyfilled properties
  var defaultSafeArea = { top: 0, bottom: 0, left: 0, right: 0 };
  var defaultUserAgent = { type: 'web', hover: true, touch: false };

  // Host context (for ext-apps and polyfill mode)
  var hostContext = window.__mcpHostContext || {
    theme: 'light',
    displayMode: 'inline'
  };

  // Trusted origin for postMessage validation (set during ext-apps initialization)
  var trustedOrigin = null;

  // Detect device capabilities
  var detectUserAgent = function() {
    var ua = navigator.userAgent || '';
    var isMobile = /iPhone|iPad|iPod|Android/i.test(ua);
    var hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    var hasHover = window.matchMedia && window.matchMedia('(hover: hover)').matches;
    return {
      type: isMobile ? 'mobile' : 'web',
      hover: hasHover !== false,
      touch: hasTouch
    };
  };

  // Detect theme from system preference
  var detectTheme = function() {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  };

  // ==================== Bridge Implementation ====================

  /**
   * MCP Bridge provides full OpenAI API compatibility.
   * On OpenAI, it proxies directly to window.openai.
   * On other platforms, it provides polyfills.
   */
  var bridge = {
    // ==================== Environment Info ====================

    get provider() {
      if (isOpenAI) return 'openai';
      if (isClaude) return 'claude';
      if (isGemini) return 'gemini';
      if (isExtApps) return 'ext-apps';
      return 'unknown';
    },

    // ==================== OpenAI-Compatible Properties ====================

    get theme() {
      if (isOpenAI && window.openai) {
        return window.openai.theme || 'light';
      }
      return hostContext.theme || detectTheme();
    },

    get userAgent() {
      if (isOpenAI && window.openai && window.openai.userAgent) {
        return window.openai.userAgent;
      }
      return hostContext.userAgent || detectUserAgent();
    },

    get locale() {
      if (isOpenAI && window.openai && window.openai.locale) {
        return window.openai.locale;
      }
      return navigator.language || 'en-US';
    },

    get maxHeight() {
      if (isOpenAI && window.openai) {
        return window.openai.maxHeight;
      }
      return hostContext.viewport ? hostContext.viewport.maxHeight : undefined;
    },

    get displayMode() {
      if (isOpenAI && window.openai) {
        return window.openai.displayMode || 'inline';
      }
      return hostContext.displayMode || 'inline';
    },

    get safeArea() {
      if (isOpenAI && window.openai && window.openai.safeArea) {
        return window.openai.safeArea;
      }
      return hostContext.safeArea || defaultSafeArea;
    },

    get toolInput() {
      if (isOpenAI && window.openai && window.openai.toolInput) {
        return window.openai.toolInput;
      }
      return window.__mcpToolInput || {};
    },

    get toolOutput() {
      if (isOpenAI && window.openai) {
        return window.openai.toolOutput;
      }
      return window.__mcpToolOutput;
    },

    get structuredContent() {
      // Alias for toolOutput to maintain compatibility
      if (isOpenAI && window.openai) {
        return window.openai.toolOutput;
      }
      return window.__mcpStructuredContent;
    },

    get toolResponseMetadata() {
      if (isOpenAI && window.openai && window.openai.toolResponseMetadata) {
        return window.openai.toolResponseMetadata;
      }
      return window.__mcpToolResponseMetadata || {};
    },

    get widgetState() {
      if (isOpenAI && window.openai) {
        return window.openai.widgetState || {};
      }
      // Polyfill: use localStorage
      try {
        var stored = localStorage.getItem('__mcpWidgetState');
        return stored ? JSON.parse(stored) : {};
      } catch (e) {
        return {};
      }
    },

    // ==================== OpenAI-Compatible Methods ====================

    callTool: function(name, params) {
      if (isOpenAI && window.openai && window.openai.callTool) {
        return window.openai.callTool(name, params);
      }
      if (isClaude) {
        return Promise.reject(new Error(
          'Tool calls are not supported in Claude widgets (network-blocked sandbox)'
        ));
      }
      if (isGemini) {
        return Promise.reject(new Error(
          'Tool calls are not supported in Gemini widgets'
        ));
      }
      if (isExtApps) {
        return this._sendRequest('tools/call', { name: name, arguments: params });
      }
      return Promise.reject(new Error('Tool calls not supported in this environment'));
    },

    requestDisplayMode: function(options) {
      if (isOpenAI && window.openai && window.openai.requestDisplayMode) {
        return window.openai.requestDisplayMode(options);
      }
      if (isExtApps) {
        return this._sendRequest('ui/request-display-mode', options);
      }
      // Polyfill: just update local state
      if (options && options.mode) {
        hostContext.displayMode = options.mode;
        contextChangeListeners.forEach(function(cb) {
          try { cb({ displayMode: options.mode }); } catch (e) {}
        });
      }
      return Promise.resolve();
    },

    requestClose: function() {
      if (isOpenAI && window.openai && window.openai.requestClose) {
        return window.openai.requestClose();
      }
      if (isExtApps) {
        return this._sendRequest('ui/request-close', {});
      }
      // Polyfill: dispatch event for parent to handle
      window.dispatchEvent(new CustomEvent('mcp:request-close'));
      return Promise.resolve();
    },

    openExternal: function(options) {
      var href = typeof options === 'string' ? options : (options && options.href);
      if (!href) {
        return Promise.reject(new Error('URL required'));
      }
      if (isOpenAI && window.openai && window.openai.openExternal) {
        return window.openai.openExternal({ href: href });
      }
      if (isExtApps) {
        return this._sendRequest('ui/open-link', { url: href });
      }
      // Fallback: open in new window
      window.open(href, '_blank', 'noopener,noreferrer');
      return Promise.resolve();
    },

    // Alias for openExternal (backwards compatibility)
    openLink: function(url) {
      return this.openExternal({ href: url });
    },

    sendFollowUpMessage: function(options) {
      var prompt = typeof options === 'string' ? options : (options && options.prompt);
      if (!prompt) {
        return Promise.reject(new Error('Prompt required'));
      }
      if (isOpenAI && window.openai && window.openai.sendFollowUpMessage) {
        return window.openai.sendFollowUpMessage({ prompt: prompt });
      }
      if (isClaude) {
        return Promise.reject(new Error(
          'Follow-up messages are not supported in Claude widgets (network-blocked sandbox)'
        ));
      }
      if (isGemini) {
        return Promise.reject(new Error(
          'Follow-up messages are not supported in Gemini widgets'
        ));
      }
      if (isExtApps) {
        return this._sendRequest('ui/message', {
          role: 'user',
          content: { type: 'text', text: prompt }
        });
      }
      return Promise.reject(new Error('Messages not supported in this environment'));
    },

    // Alias for sendFollowUpMessage (backwards compatibility)
    sendMessage: function(content) {
      return this.sendFollowUpMessage({ prompt: content });
    },

    setWidgetState: function(state) {
      if (isOpenAI && window.openai && window.openai.setWidgetState) {
        window.openai.setWidgetState(state);
        return;
      }
      // Polyfill: persist to localStorage
      try {
        localStorage.setItem('__mcpWidgetState', JSON.stringify(state));
      } catch (e) {
        console.warn('Failed to persist widget state:', e);
      }
    },

    // ==================== Context API (MCP-specific) ====================

    get context() {
      return {
        theme: this.theme,
        displayMode: this.displayMode,
        viewport: this.maxHeight ? { maxHeight: this.maxHeight } : undefined,
        userAgent: this.userAgent,
        locale: this.locale,
        safeArea: this.safeArea
      };
    },

    onContextChange: function(callback) {
      contextChangeListeners.push(callback);
      return function() {
        var index = contextChangeListeners.indexOf(callback);
        if (index > -1) contextChangeListeners.splice(index, 1);
      };
    },

    onToolResult: function(callback) {
      toolResultListeners.push(callback);
      return function() {
        var index = toolResultListeners.indexOf(callback);
        if (index > -1) toolResultListeners.splice(index, 1);
      };
    },

    // ==================== Internal Methods ====================

    _sendRequest: function(method, params) {
      return new Promise(function(resolve, reject) {
        var id = ++messageId;
        pendingRequests.set(id, { resolve: resolve, reject: reject });

        window.parent.postMessage({
          jsonrpc: '2.0',
          id: id,
          method: method,
          params: params
        }, '*');

        // Timeout after 30s
        setTimeout(function() {
          if (pendingRequests.has(id)) {
            pendingRequests.delete(id);
            reject(new Error('Request timeout'));
          }
        }, 30000);
      });
    },

    _initExtApps: function() {
      var self = this;
      return this._sendRequest('ui/initialize', {}).then(function(result) {
        if (result && result.hostContext) {
          hostContext = Object.assign(hostContext, result.hostContext);
        }
        // Note: trustedOrigin is now set from first message event origin (trust-on-first-use)
        // Send initialized notification
        window.parent.postMessage({
          jsonrpc: '2.0',
          method: 'ui/notifications/initialized',
          params: {}
        }, '*');
        return result;
      });
    }
  };

  // ==================== Event Handling ====================

  window.addEventListener('message', function(event) {
    var data = event.data;
    if (!data || data.jsonrpc !== '2.0') return;

    // Trust-on-first-use: Establish trusted origin from the first valid message
    if (isExtApps && !trustedOrigin && event.origin) {
      trustedOrigin = event.origin;
    }

    // Validate origin for ext-apps environment to prevent spoofed messages
    if (isExtApps && trustedOrigin && event.origin !== trustedOrigin) {
      console.warn('MCP Bridge: Ignoring message from untrusted origin:', event.origin);
      return;
    }

    // Handle responses
    if (data.id && pendingRequests.has(data.id)) {
      var pending = pendingRequests.get(data.id);
      pendingRequests.delete(data.id);

      if (data.error) {
        var err = new Error(data.error.message || 'Unknown error');
        err.code = data.error.code;
        err.data = data.error.data;
        pending.reject(err);
      } else {
        pending.resolve(data.result);
      }
      return;
    }

    // Handle notifications
    switch (data.method) {
      case 'ui/notifications/tool-input':
        window.__mcpToolInput = data.params && data.params.arguments;
        window.dispatchEvent(new CustomEvent('mcp:tool-input', { detail: data.params }));
        break;

      case 'ui/notifications/tool-input-partial':
        if (data.params && data.params.arguments) {
          window.__mcpToolInput = Object.assign(window.__mcpToolInput || {}, data.params.arguments);
        }
        break;

      case 'ui/notifications/tool-result':
        window.__mcpToolOutput = data.params && data.params.content;
        window.__mcpStructuredContent = data.params && data.params.structuredContent;
        toolResultListeners.forEach(function(cb) {
          try { cb(data.params); } catch (e) { console.error('Tool result listener error:', e); }
        });
        window.dispatchEvent(new CustomEvent('mcp:tool-result', { detail: data.params }));
        break;

      case 'ui/notifications/tool-cancelled':
        window.dispatchEvent(new CustomEvent('mcp:tool-cancelled', { detail: data.params }));
        break;

      case 'ui/host-context-change':
        hostContext = Object.assign(hostContext, data.params);
        contextChangeListeners.forEach(function(cb) {
          try { cb(data.params); } catch (e) { console.error('Context change listener error:', e); }
        });
        window.dispatchEvent(new CustomEvent('mcp:context-change', { detail: data.params }));
        break;

      case 'ui/size-change':
        if (hostContext.viewport) {
          hostContext.viewport = Object.assign(hostContext.viewport, data.params);
        } else {
          hostContext.viewport = data.params;
        }
        break;
    }
  });

  // ==================== Initialize ====================

  // Export bridge
  window.mcpBridge = bridge;

  // Also create window.openai polyfill for non-OpenAI platforms
  // This allows code written for OpenAI to work on other platforms
  if (!isOpenAI) {
    window.openai = {
      get theme() { return bridge.theme; },
      get userAgent() { return bridge.userAgent; },
      get locale() { return bridge.locale; },
      get maxHeight() { return bridge.maxHeight; },
      get displayMode() { return bridge.displayMode; },
      get safeArea() { return bridge.safeArea; },
      get toolInput() { return bridge.toolInput; },
      get toolOutput() { return bridge.toolOutput; },
      get toolResponseMetadata() { return bridge.toolResponseMetadata; },
      get widgetState() { return bridge.widgetState; },
      callTool: function(n, a) { return bridge.callTool(n, a); },
      requestDisplayMode: function(o) { return bridge.requestDisplayMode(o); },
      requestClose: function() { return bridge.requestClose(); },
      openExternal: function(o) { return bridge.openExternal(o); },
      sendFollowUpMessage: function(o) { return bridge.sendFollowUpMessage(o); },
      setWidgetState: function(s) { return bridge.setWidgetState(s); }
    };
  }

  // Auto-initialize for ext-apps
  if (isExtApps) {
    bridge._initExtApps().catch(function(err) {
      console.warn('Failed to initialize MCP bridge:', err);
    });
  }

  // Dispatch ready event
  window.dispatchEvent(new CustomEvent('mcp:bridge-ready'));
})();
</script>
`;

/**
 * Get the MCP Bridge runtime script as a string (without script tags)
 * Useful for inline embedding in specific scenarios.
 */
export function getMCPBridgeScript(): string {
  // Extract the script content without the <script> tags
  const match = MCP_BRIDGE_RUNTIME.match(/<script>([\s\S]*?)<\/script>/);
  return match ? match[1].trim() : '';
}

/**
 * Check if the current environment supports the MCP bridge
 */
export function isMCPBridgeSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { openai?: unknown; claude?: unknown; __mcpPlatform?: string };
  return (
    typeof w.openai !== 'undefined' ||
    typeof w.claude !== 'undefined' ||
    w.__mcpPlatform === 'claude' ||
    w.__mcpPlatform === 'gemini' ||
    window.parent !== window
  );
}
