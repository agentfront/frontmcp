/**
 * @file template.ts
 * @description MCP Apps HTML template generator.
 *
 * Generates standard HTML5 documents with embedded MCP bridge for MCP Apps spec compliance.
 *
 * @module @frontmcp/sdk/mcp-apps/template
 */

import type { McpAppsCSP, McpAppsHostContext, ToolInfo } from './types';
import { MCP_APPS_MIME_TYPE, MCP_APPS_PROTOCOL_VERSION, MCP_APPS_METHODS } from './types';
import { buildCSPMetaTag } from './csp';

// ============================================
// Template Options
// ============================================

/**
 * Options for generating MCP Apps HTML template.
 */
export interface McpAppsTemplateOptions {
  /** Tool information */
  toolInfo?: ToolInfo;
  /** Tool input arguments */
  input?: Record<string, unknown>;
  /** Tool output/result */
  output?: unknown;
  /** Structured content for UI rendering */
  structuredContent?: unknown;
  /** Content Security Policy */
  csp?: McpAppsCSP;
  /** Page title */
  title?: string;
  /** Additional head content (styles, meta tags) */
  headContent?: string;
  /** Main body content (HTML) */
  bodyContent: string;
  /** Additional scripts to include */
  scripts?: string[];
  /** Whether to include the MCP bridge runtime */
  includeBridge?: boolean;
  /** Custom bridge configuration */
  bridgeConfig?: McpAppsBridgeConfig;
  /** Initial theme */
  theme?: 'light' | 'dark';
  /** Debug mode - adds console logging */
  debug?: boolean;
}

/**
 * MCP Apps bridge configuration.
 */
export interface McpAppsBridgeConfig {
  /** Protocol version */
  protocolVersion?: string;
  /** Trusted origin for postMessage */
  trustedOrigin?: string;
  /** Request timeout in milliseconds */
  requestTimeout?: number;
}

// ============================================
// Template Generator
// ============================================

/**
 * Generate MCP Apps compliant HTML5 document.
 *
 * @param options - Template options
 * @returns Complete HTML5 document string
 *
 * @example
 * ```typescript
 * const html = generateMcpAppsTemplate({
 *   title: 'Weather Dashboard',
 *   bodyContent: '<div id="weather">Loading...</div>',
 *   toolInfo: { tool: { name: 'get_weather' } },
 *   input: { city: 'San Francisco' },
 *   output: { temperature: 72, condition: 'sunny' },
 *   csp: { connectDomains: ['https://api.weather.com'] },
 * });
 * ```
 */
export function generateMcpAppsTemplate(options: McpAppsTemplateOptions): string {
  const {
    toolInfo,
    input,
    output,
    structuredContent,
    csp,
    title = 'MCP App',
    headContent = '',
    bodyContent,
    scripts = [],
    includeBridge = true,
    bridgeConfig,
    theme = 'light',
    debug = false,
  } = options;

  // Build CSP meta tag
  const cspMeta = buildCSPMetaTag(csp);

  // Build data attributes for initial state
  const dataAttrs = buildDataAttributes({ toolInfo, input, output, structuredContent });

  // Build bridge script
  const bridgeScript = includeBridge ? generateBridgeScript({ ...bridgeConfig, debug }) : '';

  // Build additional scripts
  const additionalScripts = scripts.map((s) => `<script>${s}</script>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en" data-theme="${escapeAttr(theme)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${cspMeta}
  <meta name="mcp-apps-version" content="${MCP_APPS_PROTOCOL_VERSION}">
  <meta name="mcp-apps-mime-type" content="${MCP_APPS_MIME_TYPE}">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --mcp-bg: #ffffff;
      --mcp-text: #1a1a1a;
      --mcp-border: #e5e5e5;
      --mcp-primary: #0969da;
      --mcp-error: #cf222e;
      --mcp-success: #1a7f37;
    }
    [data-theme="dark"] {
      --mcp-bg: #0d1117;
      --mcp-text: #c9d1d9;
      --mcp-border: #30363d;
      --mcp-primary: #58a6ff;
      --mcp-error: #f85149;
      --mcp-success: #3fb950;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--mcp-bg);
      color: var(--mcp-text);
      line-height: 1.5;
    }
  </style>
  ${headContent}
</head>
<body ${dataAttrs}>
  ${bodyContent}
  ${bridgeScript}
  ${additionalScripts}
</body>
</html>`;
}

// ============================================
// Bridge Script Generator
// ============================================

/**
 * Generate the MCP Apps bridge runtime script.
 */
function generateBridgeScript(config?: McpAppsBridgeConfig & { debug?: boolean }): string {
  const {
    protocolVersion = MCP_APPS_PROTOCOL_VERSION,
    trustedOrigin = '*',
    requestTimeout = 30000,
    debug = false,
  } = config || {};

  return `<script>
(function() {
  'use strict';

  // MCP Apps Bridge Runtime
  const MCP_PROTOCOL_VERSION = '${protocolVersion}';
  const REQUEST_TIMEOUT = ${requestTimeout};
  const DEBUG = ${debug};

  // State
  let initialized = false;
  let hostContext = {};
  let pendingRequests = new Map();
  let messageId = 0;
  let trustedOrigin = '${trustedOrigin}';

  // Logging
  function log(...args) {
    if (DEBUG) console.log('[MCP Bridge]', ...args);
  }

  // Generate unique message ID
  function nextId() {
    return ++messageId;
  }

  // Send JSON-RPC message to host
  function sendMessage(message) {
    log('Sending:', message);
    parent.postMessage(message, trustedOrigin);
  }

  // Send JSON-RPC request and wait for response
  function sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      const id = nextId();
      const request = {
        jsonrpc: '2.0',
        id: id,
        method: method,
        params: params
      };

      const timeout = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error('Request timeout: ' + method));
      }, REQUEST_TIMEOUT);

      pendingRequests.set(id, { resolve, reject, timeout });
      sendMessage(request);
    });
  }

  // Send JSON-RPC notification (no response expected)
  function sendNotification(method, params) {
    sendMessage({
      jsonrpc: '2.0',
      method: method,
      params: params
    });
  }

  // Handle incoming messages from host
  function handleMessage(event) {
    // Validate origin on first message (trust-on-first-use)
    if (trustedOrigin === '*' && event.origin) {
      trustedOrigin = event.origin;
      log('Trusted origin set to:', trustedOrigin);
    }

    const data = event.data;
    if (!data || data.jsonrpc !== '2.0') return;

    log('Received:', data);

    // Handle response to our request
    if (data.id !== undefined && pendingRequests.has(data.id)) {
      const { resolve, reject, timeout } = pendingRequests.get(data.id);
      clearTimeout(timeout);
      pendingRequests.delete(data.id);

      if (data.error) {
        reject(new Error(data.error.message || 'Unknown error'));
      } else {
        resolve(data.result);
      }
      return;
    }

    // Handle notifications from host
    if (data.method) {
      handleNotification(data.method, data.params);
    }
  }

  // Handle notifications from host
  function handleNotification(method, params) {
    switch (method) {
      case '${MCP_APPS_METHODS.TOOL_INPUT}':
        window.dispatchEvent(new CustomEvent('mcp:tool-input', { detail: params }));
        break;
      case '${MCP_APPS_METHODS.TOOL_INPUT_PARTIAL}':
        window.dispatchEvent(new CustomEvent('mcp:tool-input-partial', { detail: params }));
        break;
      case '${MCP_APPS_METHODS.TOOL_RESULT}':
        window.dispatchEvent(new CustomEvent('mcp:tool-result', { detail: params }));
        break;
      case '${MCP_APPS_METHODS.TOOL_CANCELLED}':
        window.dispatchEvent(new CustomEvent('mcp:tool-cancelled', { detail: params }));
        break;
      case '${MCP_APPS_METHODS.SIZE_CHANGE}':
        window.dispatchEvent(new CustomEvent('mcp:size-change', { detail: params }));
        break;
      case '${MCP_APPS_METHODS.HOST_CONTEXT_CHANGE}':
        Object.assign(hostContext, params.changes);
        window.dispatchEvent(new CustomEvent('mcp:context-change', { detail: params.changes }));
        // Update theme if changed
        if (params.changes.theme) {
          document.documentElement.setAttribute('data-theme', params.changes.theme);
        }
        break;
      case '${MCP_APPS_METHODS.RESOURCE_TEARDOWN}':
        window.dispatchEvent(new CustomEvent('mcp:teardown', { detail: params }));
        break;
    }
  }

  // Initialize connection with host
  async function initialize() {
    if (initialized) return hostContext;

    try {
      const result = await sendRequest('${MCP_APPS_METHODS.INITIALIZE}', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          messages: ['${MCP_APPS_METHODS.TOOL_INPUT}', '${MCP_APPS_METHODS.TOOL_RESULT}']
        }
      });

      hostContext = result.hostContext || {};
      initialized = true;

      // Apply initial theme
      if (hostContext.theme) {
        document.documentElement.setAttribute('data-theme', hostContext.theme);
      }

      // Send initialized notification
      sendNotification('${MCP_APPS_METHODS.INITIALIZED}', {});

      log('Initialized with context:', hostContext);
      window.dispatchEvent(new CustomEvent('mcp:initialized', { detail: hostContext }));

      return hostContext;
    } catch (error) {
      console.error('[MCP Bridge] Initialization failed:', error);
      throw error;
    }
  }

  // Public API
  window.mcpBridge = {
    // Initialize connection
    initialize: initialize,

    // Get current host context
    getHostContext: function() {
      return { ...hostContext };
    },

    // Get tool info
    getToolInfo: function() {
      return hostContext.toolInfo;
    },

    // Call a tool on the MCP server
    callTool: function(name, args) {
      return sendRequest('${MCP_APPS_METHODS.TOOLS_CALL}', { name, arguments: args });
    },

    // Read a resource
    readResource: function(uri) {
      return sendRequest('${MCP_APPS_METHODS.RESOURCES_READ}', { uri });
    },

    // Request host to open a link
    openLink: function(url) {
      return sendRequest('${MCP_APPS_METHODS.OPEN_LINK}', { url });
    },

    // Send message to host's chat
    sendMessage: function(content) {
      return sendRequest('${MCP_APPS_METHODS.MESSAGE}', { content });
    },

    // Log message to host
    log: function(level, message, data) {
      sendNotification('${MCP_APPS_METHODS.NOTIFICATIONS_MESSAGE}', {
        level: level,
        logger: 'mcp-app',
        data: { message, ...data }
      });
    },

    // Ping host
    ping: function() {
      return sendRequest('${MCP_APPS_METHODS.PING}', {});
    },

    // Check if initialized
    isInitialized: function() {
      return initialized;
    },

    // Protocol version
    protocolVersion: MCP_PROTOCOL_VERSION
  };

  // Listen for messages
  window.addEventListener('message', handleMessage);

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      initialize().catch(function(err) {
        log('Auto-init failed:', err);
      });
    });
  } else {
    initialize().catch(function(err) {
      log('Auto-init failed:', err);
    });
  }

  log('Bridge loaded');
})();
</script>`;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Build data attributes for initial state injection.
 */
function buildDataAttributes(options: {
  toolInfo?: ToolInfo;
  input?: Record<string, unknown>;
  output?: unknown;
  structuredContent?: unknown;
}): string {
  const attrs: string[] = [];

  if (options.toolInfo) {
    attrs.push(`data-mcp-tool="${escapeAttr(JSON.stringify(options.toolInfo))}"`);
  }

  if (options.input) {
    attrs.push(`data-mcp-input="${escapeAttr(JSON.stringify(options.input))}"`);
  }

  if (options.output !== undefined) {
    attrs.push(`data-mcp-output="${escapeAttr(JSON.stringify(options.output))}"`);
  }

  if (options.structuredContent !== undefined) {
    attrs.push(`data-mcp-structured="${escapeAttr(JSON.stringify(options.structuredContent))}"`);
  }

  return attrs.join(' ');
}

/**
 * Escape HTML content.
 */
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Escape HTML attribute value.
 */
function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ============================================
// Utility Functions
// ============================================

/**
 * Wrap existing HTML content in MCP Apps template.
 *
 * @param html - Existing HTML content
 * @param options - Template options (without bodyContent)
 * @returns Complete MCP Apps HTML document
 */
export function wrapInMcpAppsTemplate(html: string, options: Omit<McpAppsTemplateOptions, 'bodyContent'>): string {
  return generateMcpAppsTemplate({
    ...options,
    bodyContent: html,
  });
}

/**
 * Create a minimal MCP Apps template for simple content.
 *
 * @param content - Simple text or HTML content
 * @param title - Page title
 * @returns Complete MCP Apps HTML document
 */
export function createSimpleMcpAppsTemplate(content: string, title?: string): string {
  return generateMcpAppsTemplate({
    title: title || 'MCP App',
    bodyContent: `<div class="mcp-content">${content}</div>`,
    includeBridge: true,
  });
}

/**
 * Extract body content from MCP Apps template.
 * Useful for testing.
 *
 * @param html - Complete HTML document
 * @returns Body content string or null
 */
export function extractBodyContent(html: string): string | null {
  const match = html.match(/<body[^>]*>([\s\S]*?)<script/);
  return match ? match[1].trim() : null;
}
