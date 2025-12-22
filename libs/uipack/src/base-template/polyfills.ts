/**
 * Platform Polyfills for Base Template
 *
 * Provides additional polyfills for MCP session detection and
 * direct HTTP fallback when not in an OpenAI or ext-apps environment.
 *
 * These polyfills complement the existing MCP_BRIDGE_RUNTIME.
 */

/**
 * MCP Session information for HTTP fallback
 */
export interface McpSession {
  /** MCP server URL */
  mcpUrl: string;
  /** Session ID for authentication */
  sessionId: string;
}

/**
 * Render the MCP session detection polyfill script.
 *
 * This provides auto-detection of MCP session info from:
 * 1. Explicit window.__frontmcp.mcpSession
 * 2. Meta tags (mcp-url, mcp-session-id)
 * 3. URL query parameters (mcpUrl, sessionId)
 * 4. Fallback values provided at render time
 *
 * @param mcpSession - Optional explicit session to bake into the template
 * @returns Script tag with polyfill code
 */
export function renderMcpSessionPolyfill(mcpSession?: McpSession): string {
  const fallbackCode = mcpSession
    ? `
      return {
        mcpUrl: '${escapeJs(mcpSession.mcpUrl)}',
        sessionId: '${escapeJs(mcpSession.sessionId)}'
      };`
    : `
      return null;`;

  return `<script>
(function() {
  'use strict';

  window.__frontmcp = window.__frontmcp || {};

  /**
   * Auto-detect MCP session from page context.
   * Tries multiple sources in order of priority.
   */
  window.__frontmcp.detectMcpSession = function() {
    // 1. Check if explicitly set by developer
    if (window.__frontmcp.mcpSession) {
      return window.__frontmcp.mcpSession;
    }

    // 2. Check meta tags
    var mcpUrlMeta = document.querySelector('meta[name="mcp-url"]');
    var sessionIdMeta = document.querySelector('meta[name="mcp-session-id"]');
    if (mcpUrlMeta && sessionIdMeta) {
      return {
        mcpUrl: mcpUrlMeta.getAttribute('content'),
        sessionId: sessionIdMeta.getAttribute('content')
      };
    }

    // 3. Check URL query parameters (for ngrok/iframe scenarios)
    try {
      var params = new URLSearchParams(window.location.search);
      var mcpUrl = params.get('mcpUrl');
      var sessionId = params.get('sessionId');
      if (mcpUrl && sessionId) {
        return { mcpUrl: mcpUrl, sessionId: sessionId };
      }
    } catch (e) {
      // URLSearchParams may not be available in all environments
    }

    // 4. Use explicit fallback if provided at render time
    ${fallbackCode}
  };

  /**
   * Enhanced callTool that uses HTTP fallback when MCP bridge is unavailable.
   * This wraps window.mcpBridge.callTool with HTTP fallback support.
   */
  window.__frontmcp.callTool = async function(toolName, args) {
    // Priority 1: Direct OpenAI SDK call (most reliable in OpenAI iframe)
    if (typeof window !== 'undefined' && window.openai && typeof window.openai.callTool === 'function') {
      return window.openai.callTool(toolName, args);
    }

    // Priority 2: If MCP bridge has callTool, use it
    if (window.mcpBridge && typeof window.mcpBridge.callTool === 'function') {
      try {
        return await window.mcpBridge.callTool(toolName, args);
      } catch (e) {
        // If MCP bridge fails, fall through to HTTP fallback
        console.warn('MCP bridge callTool failed, trying HTTP fallback:', e.message);
      }
    }

    // Priority 3: HTTP fallback using detected session
    var session = window.__frontmcp.detectMcpSession();
    if (!session) {
      throw new Error(
        'MCP session not available. Set window.__frontmcp.mcpSession, ' +
        'add meta tags, or provide URL parameters.'
      );
    }

    var response = await fetch(session.mcpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': session.sessionId
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: toolName, arguments: args || {} },
        id: Date.now()
      })
    });

    if (!response.ok) {
      throw new Error('HTTP ' + response.status + ': ' + response.statusText);
    }

    var result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Tool call failed');
    }
    return result.result;
  };

  /**
   * Get tool output from all possible sources.
   * Priority: pre-rendered HTML from metadata > structured data > raw output
   *
   * Note: Returns undefined for null values from OpenAI (which is its initial state)
   * to allow proper loading state handling in the bridge.
   */
  window.__frontmcp.getToolOutput = function() {
    // 1. Check for pre-rendered HTML in OpenAI toolResponseMetadata (highest priority)
    // This is set when the tool has a UI template (React, HTML, etc.)
    if (window.openai && window.openai.toolResponseMetadata) {
      var html = window.openai.toolResponseMetadata['ui/html'];
      if (html && typeof html === 'string') {
        return html;  // Return HTML string directly
      }
    }

    // 2. Check for pre-rendered HTML in MCP response metadata (for MCP Inspector, etc.)
    if (window.__mcpResponseMeta) {
      var mcpHtml = window.__mcpResponseMeta['ui/html'];
      if (mcpHtml && typeof mcpHtml === 'string') {
        return mcpHtml;  // Return HTML string directly
      }
    }

    // 3. OpenAI injects structured data into window.openai.toolOutput
    // Skip null - that's OpenAI's initial state before real data is injected
    if (window.openai && window.openai.toolOutput !== undefined && window.openai.toolOutput !== null) {
      return window.openai.toolOutput;
    }

    // 4. MCP Bridge stores in window.__mcpToolOutput (skip null)
    if (window.__mcpToolOutput !== undefined && window.__mcpToolOutput !== null) {
      return window.__mcpToolOutput;
    }

    // 5. Explicit injection
    if (window.__frontmcp.toolOutput !== undefined) {
      return window.__frontmcp.toolOutput;
    }

    return undefined;
  };
})();
</script>`;
}

/**
 * Escape string for use in JavaScript string literal
 */
function escapeJs(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/`/g, '\\`')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/<\/script/gi, '<\\/script')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
