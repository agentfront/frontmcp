/**
 * IIFE Generator for FrontMcpBridge Runtime
 *
 * Generates vanilla JavaScript IIFE scripts that can be embedded
 * in HTML templates for runtime platform detection and bridge setup.
 *
 * @packageDocumentation
 */

/**
 * Options for generating the bridge IIFE.
 */
export interface IIFEGeneratorOptions {
  /** Include specific adapters (all if not specified) */
  adapters?: ('openai' | 'ext-apps' | 'claude' | 'gemini' | 'generic')[];
  /** Enable debug logging */
  debug?: boolean;
  /** Trusted origins for ext-apps adapter */
  trustedOrigins?: string[];
  /** Minify the output */
  minify?: boolean;
}

/**
 * Generate the bridge runtime IIFE script.
 *
 * This generates a self-contained vanilla JavaScript script that:
 * 1. Detects the current platform
 * 2. Initializes the appropriate adapter
 * 3. Exposes window.FrontMcpBridge global
 *
 * @example
 * ```typescript
 * import { generateBridgeIIFE } from '@frontmcp/ui/bridge';
 *
 * const script = generateBridgeIIFE({ debug: true });
 * const html = `<script>${script}</script>`;
 * ```
 */
export function generateBridgeIIFE(options: IIFEGeneratorOptions = {}): string {
  const { debug = false, trustedOrigins = [], minify = false } = options;
  const adapters = options.adapters || ['openai', 'ext-apps', 'claude', 'gemini', 'generic'];

  const parts: string[] = [];

  // Start IIFE
  parts.push('(function() {');
  parts.push('"use strict";');
  parts.push('');

  // Debug logging
  if (debug) {
    parts.push('function log(msg) { console.log("[FrontMcpBridge] " + msg); }');
  } else {
    parts.push('function log() {}');
  }
  parts.push('');

  // Default safe area
  parts.push('var DEFAULT_SAFE_AREA = { top: 0, bottom: 0, left: 0, right: 0 };');
  parts.push('');

  // Host context detection
  parts.push(generateContextDetection());
  parts.push('');

  // Base adapter capabilities
  parts.push(generateBaseCapabilities());
  parts.push('');

  // Generate selected adapters
  if (adapters.includes('openai')) {
    parts.push(generateOpenAIAdapter());
    parts.push('');
  }

  if (adapters.includes('ext-apps')) {
    parts.push(generateExtAppsAdapter(trustedOrigins));
    parts.push('');
  }

  if (adapters.includes('claude')) {
    parts.push(generateClaudeAdapter());
    parts.push('');
  }

  if (adapters.includes('gemini')) {
    parts.push(generateGeminiAdapter());
    parts.push('');
  }

  if (adapters.includes('generic')) {
    parts.push(generateGenericAdapter());
    parts.push('');
  }

  // Platform detection and initialization
  parts.push(generatePlatformDetection(adapters));
  parts.push('');

  // Bridge class
  parts.push(generateBridgeClass());
  parts.push('');

  // Initialize and expose
  parts.push('var bridge = new FrontMcpBridge();');
  parts.push('bridge.initialize().then(function() {');
  parts.push('  log("Bridge initialized with adapter: " + bridge.adapterId);');
  parts.push('  window.dispatchEvent(new CustomEvent("bridge:ready", { detail: { adapter: bridge.adapterId } }));');
  parts.push('}).catch(function(err) {');
  parts.push('  console.error("[FrontMcpBridge] Init failed:", err);');
  parts.push('  window.dispatchEvent(new CustomEvent("bridge:error", { detail: { error: err } }));');
  parts.push('});');
  parts.push('');

  // Expose global
  parts.push('window.FrontMcpBridge = bridge;');

  // End IIFE
  parts.push('})();');

  const code = parts.join('\n');

  if (minify) {
    return minifyJS(code);
  }

  return code;
}

/**
 * Generate context detection helper.
 */
function generateContextDetection(): string {
  return `
function detectTheme() {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

function detectLocale() {
  if (typeof navigator !== 'undefined') {
    return navigator.language || 'en-US';
  }
  return 'en-US';
}

function detectUserAgent() {
  if (typeof navigator === 'undefined') {
    return { type: 'web', hover: true, touch: false };
  }
  var ua = navigator.userAgent || '';
  var isMobile = /iPhone|iPad|iPod|Android/i.test(ua);
  var hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  var hasHover = window.matchMedia && window.matchMedia('(hover: hover)').matches;
  return { type: isMobile ? 'mobile' : 'web', hover: hasHover !== false, touch: hasTouch };
}

function detectViewport() {
  if (typeof window !== 'undefined') {
    return { width: window.innerWidth, height: window.innerHeight };
  }
  return undefined;
}

function readInjectedData() {
  var data = { toolInput: {}, toolOutput: undefined, structuredContent: undefined };
  if (typeof window !== 'undefined') {
    if (window.__mcpToolInput) data.toolInput = window.__mcpToolInput;
    if (window.__mcpToolOutput) data.toolOutput = window.__mcpToolOutput;
    if (window.__mcpStructuredContent) data.structuredContent = window.__mcpStructuredContent;
  }
  return data;
}
`.trim();
}

/**
 * Generate base capabilities object.
 */
function generateBaseCapabilities(): string {
  return `
var DEFAULT_CAPABILITIES = {
  canCallTools: false,
  canSendMessages: false,
  canOpenLinks: false,
  canPersistState: true,
  hasNetworkAccess: true,
  supportsDisplayModes: false,
  supportsTheme: true
};
`.trim();
}

/**
 * Generate OpenAI adapter code.
 */
function generateOpenAIAdapter(): string {
  return `
var OpenAIAdapter = {
  id: 'openai',
  name: 'OpenAI ChatGPT',
  priority: 100,
  capabilities: Object.assign({}, DEFAULT_CAPABILITIES, {
    canCallTools: true,
    canSendMessages: true,
    canOpenLinks: true,
    supportsDisplayModes: true
  }),
  canHandle: function() {
    if (typeof window === 'undefined') return false;
    // Check for window.openai.callTool (the actual OpenAI SDK API)
    if (window.openai && typeof window.openai.callTool === 'function') return true;
    // Also check if we're being injected with tool metadata (OpenAI injects toolOutput)
    if (window.openai && (window.openai.toolOutput !== undefined || window.openai.toolInput !== undefined)) return true;
    return false;
  },
  initialize: function(context) {
    var sdk = window.openai;
    context.sdk = sdk;
    // OpenAI SDK exposes theme and displayMode directly as properties
    if (sdk.theme) {
      context.hostContext.theme = sdk.theme;
    }
    if (sdk.displayMode) {
      context.hostContext.displayMode = sdk.displayMode;
    }
    // Note: OpenAI SDK does not have an onContextChange equivalent
    return Promise.resolve();
  },
  callTool: function(context, name, args) {
    return context.sdk.callTool(name, args);
  },
  sendMessage: function(context, content) {
    if (typeof context.sdk.sendFollowUpMessage === 'function') {
      return context.sdk.sendFollowUpMessage(content);
    }
    return Promise.reject(new Error('Messages not supported'));
  },
  openLink: function(context, url) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return Promise.resolve();
  },
  requestDisplayMode: function(context, mode) {
    return Promise.resolve();
  },
  requestClose: function(context) {
    return Promise.resolve();
  }
};
`.trim();
}

/**
 * Generate ext-apps adapter code.
 */
function generateExtAppsAdapter(trustedOrigins: string[]): string {
  const originsArray = trustedOrigins.length > 0 ? JSON.stringify(trustedOrigins) : '[]';

  return `
var ExtAppsAdapter = {
  id: 'ext-apps',
  name: 'ext-apps (SEP-1865)',
  priority: 80,
  capabilities: Object.assign({}, DEFAULT_CAPABILITIES, { canPersistState: true, hasNetworkAccess: true }),
  trustedOrigins: ${originsArray},
  trustedOrigin: null,
  pendingRequests: {},
  requestId: 0,
  hostCapabilities: {},
  canHandle: function() {
    if (typeof window === 'undefined') return false;
    if (window.parent === window) return false;
    // Check for OpenAI SDK (window.openai.callTool) - defer to OpenAIAdapter
    if (window.openai && typeof window.openai.callTool === 'function') return false;
    if (window.__mcpPlatform === 'ext-apps') return true;
    return true;
  },
  initialize: function(context) {
    var self = this;
    context.extApps = this;

    window.addEventListener('message', function(event) {
      self.handleMessage(context, event);
    });

    return self.performHandshake(context);
  },
  handleMessage: function(context, event) {
    if (!this.isOriginTrusted(event.origin)) return;
    var data = event.data;
    if (!data || typeof data !== 'object' || data.jsonrpc !== '2.0') return;

    if ('id' in data && (data.result !== undefined || data.error !== undefined)) {
      var pending = this.pendingRequests[data.id];
      if (pending) {
        clearTimeout(pending.timeout);
        delete this.pendingRequests[data.id];
        if (data.error) {
          pending.reject(new Error(data.error.message + ' (code: ' + data.error.code + ')'));
        } else {
          pending.resolve(data.result);
        }
      }
      return;
    }

    if ('method' in data && !('id' in data)) {
      this.handleNotification(context, data);
    }
  },
  handleNotification: function(context, notification) {
    var params = notification.params || {};
    switch (notification.method) {
      case 'ui/notifications/tool-input':
        context.toolInput = params.arguments || {};
        window.dispatchEvent(new CustomEvent('tool:input', { detail: { arguments: context.toolInput } }));
        break;
      case 'ui/notifications/tool-result':
        context.toolOutput = params.content;
        context.structuredContent = params.structuredContent;
        context.notifyToolResult(params.content);
        window.dispatchEvent(new CustomEvent('tool:result', { detail: params }));
        break;
      case 'ui/notifications/host-context-changed':
        Object.assign(context.hostContext, params);
        context.notifyContextChange(params);
        break;
    }
  },
  isOriginTrusted: function(origin) {
    if (this.trustedOrigins.length > 0) {
      return this.trustedOrigins.indexOf(origin) !== -1;
    }
    if (!this.trustedOrigin) {
      this.trustedOrigin = origin;
      return true;
    }
    return this.trustedOrigin === origin;
  },
  sendRequest: function(method, params) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var id = ++self.requestId;
      var timeout = setTimeout(function() {
        delete self.pendingRequests[id];
        reject(new Error('Request ' + method + ' timed out'));
      }, 10000);

      self.pendingRequests[id] = { resolve: resolve, reject: reject, timeout: timeout };

      var targetOrigin = self.trustedOrigin || '*';
      window.parent.postMessage({ jsonrpc: '2.0', id: id, method: method, params: params }, targetOrigin);
    });
  },
  performHandshake: function(context) {
    var self = this;
    var params = {
      appInfo: { name: 'FrontMCP Widget', version: '1.0.0' },
      appCapabilities: { tools: { listChanged: false } },
      protocolVersion: '2024-11-05'
    };

    return this.sendRequest('ui/initialize', params).then(function(result) {
      self.hostCapabilities = result.hostCapabilities || {};
      self.capabilities = Object.assign({}, self.capabilities, {
        canCallTools: Boolean(self.hostCapabilities.serverToolProxy),
        canSendMessages: true,
        canOpenLinks: Boolean(self.hostCapabilities.openLink),
        supportsDisplayModes: true
      });
      if (result.hostContext) {
        Object.assign(context.hostContext, result.hostContext);
      }
    });
  },
  callTool: function(context, name, args) {
    if (!this.hostCapabilities.serverToolProxy) {
      return Promise.reject(new Error('Server tool proxy not supported'));
    }
    return this.sendRequest('ui/callServerTool', { name: name, arguments: args });
  },
  sendMessage: function(context, content) {
    return this.sendRequest('ui/message', { content: content });
  },
  openLink: function(context, url) {
    if (!this.hostCapabilities.openLink) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return Promise.resolve();
    }
    return this.sendRequest('ui/openLink', { url: url });
  },
  requestDisplayMode: function(context, mode) {
    return this.sendRequest('ui/setDisplayMode', { mode: mode });
  },
  requestClose: function(context) {
    return this.sendRequest('ui/close', {});
  }
};
`.trim();
}

/**
 * Generate Claude adapter code.
 */
function generateClaudeAdapter(): string {
  return `
var ClaudeAdapter = {
  id: 'claude',
  name: 'Claude (Anthropic)',
  priority: 60,
  capabilities: Object.assign({}, DEFAULT_CAPABILITIES, {
    canCallTools: false,
    canSendMessages: false,
    canOpenLinks: true,
    hasNetworkAccess: false,
    supportsDisplayModes: false
  }),
  canHandle: function() {
    if (typeof window === 'undefined') return false;
    if (window.__mcpPlatform === 'claude') return true;
    if (window.claude) return true;
    if (window.__claudeArtifact) return true;
    if (typeof location !== 'undefined') {
      var href = location.href;
      if (href.indexOf('claude.ai') !== -1 || href.indexOf('anthropic.com') !== -1) return true;
    }
    return false;
  },
  initialize: function(context) {
    return Promise.resolve();
  },
  callTool: function() {
    return Promise.reject(new Error('Tool calls not supported in Claude'));
  },
  sendMessage: function() {
    return Promise.reject(new Error('Messages not supported in Claude'));
  },
  openLink: function(context, url) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return Promise.resolve();
  },
  requestDisplayMode: function() {
    return Promise.resolve();
  },
  requestClose: function() {
    return Promise.resolve();
  }
};
`.trim();
}

/**
 * Generate Gemini adapter code.
 */
function generateGeminiAdapter(): string {
  return `
var GeminiAdapter = {
  id: 'gemini',
  name: 'Google Gemini',
  priority: 40,
  capabilities: Object.assign({}, DEFAULT_CAPABILITIES, {
    canOpenLinks: true,
    hasNetworkAccess: true
  }),
  canHandle: function() {
    if (typeof window === 'undefined') return false;
    if (window.__mcpPlatform === 'gemini') return true;
    if (window.gemini) return true;
    if (typeof location !== 'undefined') {
      var href = location.href;
      if (href.indexOf('gemini.google.com') !== -1 || href.indexOf('bard.google.com') !== -1) return true;
    }
    return false;
  },
  initialize: function(context) {
    if (window.gemini && window.gemini.ui && window.gemini.ui.getTheme) {
      context.hostContext.theme = window.gemini.ui.getTheme() === 'dark' ? 'dark' : 'light';
    }
    return Promise.resolve();
  },
  callTool: function() {
    return Promise.reject(new Error('Tool calls not supported in Gemini'));
  },
  sendMessage: function(context, content) {
    if (window.gemini && window.gemini.ui && window.gemini.ui.sendMessage) {
      return window.gemini.ui.sendMessage(content);
    }
    return Promise.reject(new Error('Messages not supported in Gemini'));
  },
  openLink: function(context, url) {
    if (window.gemini && window.gemini.ui && window.gemini.ui.openLink) {
      return window.gemini.ui.openLink(url);
    }
    window.open(url, '_blank', 'noopener,noreferrer');
    return Promise.resolve();
  },
  requestDisplayMode: function() {
    return Promise.resolve();
  },
  requestClose: function() {
    return Promise.resolve();
  }
};
`.trim();
}

/**
 * Generate Generic adapter code.
 */
function generateGenericAdapter(): string {
  return `
var GenericAdapter = {
  id: 'generic',
  name: 'Generic Web',
  priority: 0,
  capabilities: Object.assign({}, DEFAULT_CAPABILITIES, {
    canOpenLinks: true,
    hasNetworkAccess: true
  }),
  canHandle: function() {
    return typeof window !== 'undefined';
  },
  initialize: function(context) {
    return Promise.resolve();
  },
  callTool: function() {
    return Promise.reject(new Error('Tool calls not supported'));
  },
  sendMessage: function() {
    return Promise.reject(new Error('Messages not supported'));
  },
  openLink: function(context, url) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return Promise.resolve();
  },
  requestDisplayMode: function() {
    return Promise.resolve();
  },
  requestClose: function() {
    return Promise.resolve();
  }
};
`.trim();
}

/**
 * Generate platform detection logic.
 */
function generatePlatformDetection(adapters: string[]): string {
  const adapterVars = adapters
    .map((a) => {
      switch (a) {
        case 'openai':
          return 'OpenAIAdapter';
        case 'ext-apps':
          return 'ExtAppsAdapter';
        case 'claude':
          return 'ClaudeAdapter';
        case 'gemini':
          return 'GeminiAdapter';
        case 'generic':
          return 'GenericAdapter';
        default:
          return '';
      }
    })
    .filter(Boolean);

  return `
var ADAPTERS = [${adapterVars.join(', ')}].sort(function(a, b) { return b.priority - a.priority; });

function detectPlatform() {
  for (var i = 0; i < ADAPTERS.length; i++) {
    if (ADAPTERS[i].canHandle()) {
      log('Detected platform: ' + ADAPTERS[i].id);
      return ADAPTERS[i];
    }
  }
  log('No platform detected, using generic');
  return GenericAdapter;
}
`.trim();
}

/**
 * Generate the main bridge class.
 */
function generateBridgeClass(): string {
  return `
function FrontMcpBridge() {
  this._adapter = null;
  this._initialized = false;
  this._context = {
    hostContext: {
      theme: detectTheme(),
      displayMode: 'inline',
      locale: detectLocale(),
      userAgent: detectUserAgent(),
      safeArea: DEFAULT_SAFE_AREA,
      viewport: detectViewport()
    },
    toolInput: {},
    toolOutput: undefined,
    structuredContent: undefined,
    widgetState: {},
    contextListeners: [],
    toolResultListeners: [],
    notifyContextChange: function(changes) {
      Object.assign(this.hostContext, changes);
      for (var i = 0; i < this.contextListeners.length; i++) {
        try { this.contextListeners[i](changes); } catch(e) {}
      }
    },
    notifyToolResult: function(result) {
      this.toolOutput = result;
      for (var i = 0; i < this.toolResultListeners.length; i++) {
        try { this.toolResultListeners[i](result); } catch(e) {}
      }
    }
  };

  var injected = readInjectedData();
  this._context.toolInput = injected.toolInput;
  this._context.toolOutput = injected.toolOutput;
  this._context.structuredContent = injected.structuredContent;

  this._loadWidgetState();
}

FrontMcpBridge.prototype._loadWidgetState = function() {
  try {
    var key = 'frontmcp:widget:' + (window.__mcpToolName || 'unknown');
    var stored = localStorage.getItem(key);
    if (stored) this._context.widgetState = JSON.parse(stored);
  } catch(e) {}
};

FrontMcpBridge.prototype._saveWidgetState = function() {
  try {
    var key = 'frontmcp:widget:' + (window.__mcpToolName || 'unknown');
    localStorage.setItem(key, JSON.stringify(this._context.widgetState));
  } catch(e) {}
};

FrontMcpBridge.prototype.initialize = function() {
  if (this._initialized) return Promise.resolve();
  var self = this;
  this._adapter = detectPlatform();
  return this._adapter.initialize(this._context).then(function() {
    self._initialized = true;
    // Set up the data-tool-call click handler after initialization
    self._setupDataToolCallHandler();
  });
};

Object.defineProperty(FrontMcpBridge.prototype, 'initialized', { get: function() { return this._initialized; } });
Object.defineProperty(FrontMcpBridge.prototype, 'adapterId', { get: function() { return this._adapter ? this._adapter.id : undefined; } });
Object.defineProperty(FrontMcpBridge.prototype, 'capabilities', { get: function() { return this._adapter ? this._adapter.capabilities : DEFAULT_CAPABILITIES; } });

FrontMcpBridge.prototype.getTheme = function() { return this._context.hostContext.theme; };
FrontMcpBridge.prototype.getDisplayMode = function() { return this._context.hostContext.displayMode; };
FrontMcpBridge.prototype.getToolInput = function() { return this._context.toolInput; };
FrontMcpBridge.prototype.getToolOutput = function() { return this._context.toolOutput; };
FrontMcpBridge.prototype.getStructuredContent = function() { return this._context.structuredContent; };
FrontMcpBridge.prototype.getWidgetState = function() { return this._context.widgetState; };
FrontMcpBridge.prototype.getHostContext = function() { return Object.assign({}, this._context.hostContext); };
FrontMcpBridge.prototype.hasCapability = function(cap) { return this._adapter && this._adapter.capabilities[cap] === true; };

// Get tool response metadata (platform-agnostic)
// Used by inline mode widgets to detect when ui/html arrives
FrontMcpBridge.prototype.getToolResponseMetadata = function() {
  // OpenAI injects toolResponseMetadata for widget-producing tools
  if (typeof window !== 'undefined' && window.openai && window.openai.toolResponseMetadata) {
    return window.openai.toolResponseMetadata;
  }
  // Claude (future support)
  if (typeof window !== 'undefined' && window.claude && window.claude.toolResponseMetadata) {
    return window.claude.toolResponseMetadata;
  }
  // FrontMCP direct injection (for testing/ext-apps)
  if (typeof window !== 'undefined' && window.__mcpToolResponseMetadata) {
    return window.__mcpToolResponseMetadata;
  }
  return null;
};

// Subscribe to tool response metadata changes (for inline mode injection)
FrontMcpBridge.prototype.onToolResponseMetadata = function(callback) {
  var self = this;
  var called = false;

  // Check if already available
  var existing = self.getToolResponseMetadata();
  if (existing) {
    called = true;
    callback(existing);
  }

  // Set up property interceptors for OpenAI
  if (typeof window !== 'undefined') {
    // OpenAI: Intercept toolResponseMetadata assignment
    if (!window.__frontmcpMetadataIntercepted) {
      window.__frontmcpMetadataIntercepted = true;
      window.__frontmcpMetadataCallbacks = [];

      // Create openai object if it doesn't exist
      if (!window.openai) window.openai = {};

      var originalMetadata = window.openai.toolResponseMetadata;
      Object.defineProperty(window.openai, 'toolResponseMetadata', {
        get: function() { return originalMetadata; },
        set: function(val) {
          originalMetadata = val;
          log('toolResponseMetadata set, notifying ' + window.__frontmcpMetadataCallbacks.length + ' listeners');
          for (var i = 0; i < window.__frontmcpMetadataCallbacks.length; i++) {
            try { window.__frontmcpMetadataCallbacks[i](val); } catch(e) {}
          }
        },
        configurable: true
      });
    }

    // Register callback
    window.__frontmcpMetadataCallbacks.push(function(metadata) {
      if (!called) {
        called = true;
        callback(metadata);
      }
    });
  }

  // Return unsubscribe function
  return function() {
    if (window.__frontmcpMetadataCallbacks) {
      var idx = window.__frontmcpMetadataCallbacks.indexOf(callback);
      if (idx !== -1) window.__frontmcpMetadataCallbacks.splice(idx, 1);
    }
  };
};

FrontMcpBridge.prototype.callTool = function(name, args) {
  // Priority 1: Direct OpenAI SDK call (most reliable in OpenAI iframe)
  // This bypasses adapter abstraction for maximum compatibility
  if (typeof window !== 'undefined' && window.openai && typeof window.openai.callTool === 'function') {
    log('callTool: Using OpenAI SDK directly');
    return window.openai.callTool(name, args);
  }

  // Priority 2: Use adapter (if initialized and supports tool calls)
  if (this._adapter && this._adapter.capabilities && this._adapter.capabilities.canCallTools) {
    log('callTool: Using adapter ' + this._adapter.id);
    return this._adapter.callTool(this._context, name, args);
  }

  // Not initialized or no tool support
  if (!this._adapter) {
    return Promise.reject(new Error('Bridge not initialized. Wait for bridge:ready event.'));
  }
  return Promise.reject(new Error('Tool calls not supported on this platform (' + this._adapter.id + ')'));
};

FrontMcpBridge.prototype.sendMessage = function(content) {
  if (!this._adapter) return Promise.reject(new Error('Not initialized'));
  return this._adapter.sendMessage(this._context, content);
};

FrontMcpBridge.prototype.openLink = function(url) {
  if (!this._adapter) return Promise.reject(new Error('Not initialized'));
  return this._adapter.openLink(this._context, url);
};

FrontMcpBridge.prototype.requestDisplayMode = function(mode) {
  if (!this._adapter) return Promise.reject(new Error('Not initialized'));
  var self = this;
  return this._adapter.requestDisplayMode(this._context, mode).then(function() {
    self._context.hostContext.displayMode = mode;
  });
};

FrontMcpBridge.prototype.requestClose = function() {
  if (!this._adapter) return Promise.reject(new Error('Not initialized'));
  return this._adapter.requestClose(this._context);
};

FrontMcpBridge.prototype.setWidgetState = function(state) {
  Object.assign(this._context.widgetState, state);
  this._saveWidgetState();
};

FrontMcpBridge.prototype.onContextChange = function(callback) {
  var listeners = this._context.contextListeners;
  listeners.push(callback);
  return function() {
    var idx = listeners.indexOf(callback);
    if (idx !== -1) listeners.splice(idx, 1);
  };
};

FrontMcpBridge.prototype.onToolResult = function(callback) {
  var listeners = this._context.toolResultListeners;
  listeners.push(callback);
  return function() {
    var idx = listeners.indexOf(callback);
    if (idx !== -1) listeners.splice(idx, 1);
  };
};

// ==================== data-tool-call Click Handler ====================

FrontMcpBridge.prototype._setupDataToolCallHandler = function() {
  var self = this;

  document.addEventListener('click', function(e) {
    // Find the closest element with data-tool-call attribute
    var target = e.target;
    while (target && target !== document) {
      if (target.hasAttribute && target.hasAttribute('data-tool-call')) {
        var toolName = target.getAttribute('data-tool-call');
        var argsAttr = target.getAttribute('data-tool-args');
        var args = {};

        try {
          if (argsAttr) {
            args = JSON.parse(argsAttr);
          }
        } catch (parseErr) {
          console.error('[frontmcp] Failed to parse data-tool-args:', parseErr);
        }

        log('data-tool-call clicked: ' + toolName);

        // Show loading state - save original content first
        var originalContent = target.innerHTML;
        var originalDisabled = target.disabled;
        target.disabled = true;
        target.classList.add('opacity-50', 'cursor-not-allowed');

        // Add spinner for buttons
        var spinner = '<svg class="animate-spin -ml-1 mr-2 h-4 w-4 inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>';
        if (target.tagName === 'BUTTON') {
          target.innerHTML = spinner + 'Loading...';
        }

        // Helper to reset button state
        function resetButton() {
          target.innerHTML = originalContent;
          target.disabled = originalDisabled;
          target.classList.remove('opacity-50', 'cursor-not-allowed');
        }

        // Determine how to call the tool
        var toolCallPromise;

        // Priority 1: Direct OpenAI SDK call (bypasses adapter abstraction)
        if (typeof window !== 'undefined' && window.openai && typeof window.openai.callTool === 'function') {
          log('Using OpenAI SDK directly for tool call');
          toolCallPromise = window.openai.callTool(toolName, args);
        }
        // Priority 2: Use adapter (if it supports tool calls)
        else if (self.hasCapability('canCallTools')) {
          log('Using adapter for tool call');
          toolCallPromise = self.callTool(toolName, args);
        }
        // No tool call capability
        else {
          console.error('[frontmcp] Tool calls not supported on this platform (' + self.adapterId + ')');
          resetButton();
          target.dispatchEvent(new CustomEvent('tool:error', {
            detail: { name: toolName, args: args, error: 'Tool calls not supported on this platform' },
            bubbles: true
          }));
          e.preventDefault();
          return;
        }

        // Handle the tool call result
        toolCallPromise.then(function(result) {
          log('Tool call succeeded: ' + toolName);
          resetButton();

          // Update bridge state to trigger widget re-render
          // React isn't hydrated in OpenAI iframe, so useState doesn't work
          // Instead, we use the bridge's reactive state system
          if (result && window.__frontmcp && window.__frontmcp.bridge) {
            var newData = result.structuredContent || result;
            log('Updating bridge state with new data');
            window.__frontmcp.bridge.setData(newData);
          }

          // Dispatch success event
          target.dispatchEvent(new CustomEvent('tool:success', {
            detail: { name: toolName, args: args, result: result },
            bubbles: true
          }));
        }).catch(function(err) {
          console.error('[frontmcp] Tool call failed: ' + toolName, err);
          resetButton();
          // Dispatch error event
          target.dispatchEvent(new CustomEvent('tool:error', {
            detail: { name: toolName, args: args, error: err.message || err },
            bubbles: true
          }));
        });

        // Prevent default behavior (e.g., form submission)
        e.preventDefault();
        return;
      }
      target = target.parentElement;
    }
  }, true); // Use capture phase to handle before React handlers
};
`.trim();
}

/**
 * Simple JS minification (removes extra whitespace and newlines).
 */
function minifyJS(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
    .replace(/\/\/.*$/gm, '') // Remove line comments
    .replace(/\s+/g, ' ') // Collapse whitespace
    .replace(/\s*([{};,:()\[\]])\s*/g, '$1') // Remove space around punctuation
    .replace(/;\}/g, '}') // Remove trailing semicolons before }
    .trim();
}

/**
 * Generate platform-specific bundle IIFE.
 *
 * @example ChatGPT-specific bundle
 * ```typescript
 * const script = generatePlatformBundle('chatgpt');
 * ```
 */
export function generatePlatformBundle(
  platform: 'chatgpt' | 'claude' | 'gemini' | 'universal',
  options: Omit<IIFEGeneratorOptions, 'adapters'> = {},
): string {
  const platformAdapters: Record<string, IIFEGeneratorOptions['adapters']> = {
    chatgpt: ['openai', 'generic'],
    claude: ['claude', 'generic'],
    gemini: ['gemini', 'generic'],
    universal: ['openai', 'ext-apps', 'claude', 'gemini', 'generic'],
  };

  return generateBridgeIIFE({
    ...options,
    adapters: platformAdapters[platform],
  });
}

/**
 * Pre-generated universal bridge script (includes all adapters).
 * Use this for the simplest integration.
 */
export const UNIVERSAL_BRIDGE_SCRIPT = generateBridgeIIFE();

/**
 * Pre-generated bridge scripts wrapped in script tags.
 */
export const BRIDGE_SCRIPT_TAGS = {
  universal: `<script>${UNIVERSAL_BRIDGE_SCRIPT}</script>`,
  chatgpt: `<script>${generatePlatformBundle('chatgpt')}</script>`,
  claude: `<script>${generatePlatformBundle('claude')}</script>`,
  gemini: `<script>${generatePlatformBundle('gemini')}</script>`,
};
