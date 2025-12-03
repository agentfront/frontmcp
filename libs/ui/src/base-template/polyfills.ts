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
  var originalCallTool = window.__frontmcp.callTool;
  window.__frontmcp.callTool = async function(toolName, args) {
    // If MCP bridge has callTool, use it
    if (window.mcpBridge && typeof window.mcpBridge.callTool === 'function') {
      try {
        return await window.mcpBridge.callTool(toolName, args);
      } catch (e) {
        // If MCP bridge fails, fall through to HTTP fallback
        console.warn('MCP bridge callTool failed, trying HTTP fallback:', e.message);
      }
    }

    // HTTP fallback using detected session
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

    var result = await response.json();
    if (result.error) {
      throw new Error(result.error.message || 'Tool call failed');
    }
    return result.result;
  };

  /**
   * Get tool output from all possible sources.
   */
  window.__frontmcp.getToolOutput = function() {
    // OpenAI injects into window.openai.toolOutput
    if (window.openai && window.openai.toolOutput !== undefined) {
      return window.openai.toolOutput;
    }
    // MCP Bridge stores in window.__mcpToolOutput
    if (window.__mcpToolOutput !== undefined) {
      return window.__mcpToolOutput;
    }
    // Explicit injection
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
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}
