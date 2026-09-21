/**
 * Base Template
 *
 * Creates default base template for resources/read responses.
 * Uses buildShell() from uipack/shell with bridge IIFE.
 *
 * @packageDocumentation
 */

import { generateBridgeIIFE } from '../bridge-runtime';
import { buildShell } from '../shell/builder';
import { escapeHtml } from '../utils';

/**
 * Options for creating a default base template.
 */
export interface DefaultBaseTemplateOptions {
  /** Tool name for data injection */
  toolName: string;
}

/**
 * Create a default base template for `resources/read` responses.
 *
 * Returns a full HTML document with:
 * - CSP meta tag
 * - Data injection placeholders (window globals)
 * - Bridge runtime IIFE for `ui/initialize` handshake
 * - A root element for widget rendering
 *
 * The bridge handles:
 * - `ui/initialize` handshake with the host
 * - `ui/notifications/tool-result` data injection from host
 */
export function createDefaultBaseTemplate(options: DefaultBaseTemplateOptions): string {
  const { toolName } = options;

  // The name reaches here straight from a `resources/read` URI, so it is caller-controlled
  // (GHSA-xp6r-ggxc-j7q8). A template must escape what it interpolates rather than trust its
  // callers to have validated it.
  const safeToolName = escapeHtml(toolName);

  const bridgeScript = `<script>${generateBridgeIIFE({ minify: true })}</script>`;

  const content = `
${bridgeScript}
<div id="root">
  <div style="font-family:system-ui,sans-serif;padding:1rem;color:#374151;">
    <p style="color:#6b7280;font-size:0.875rem;">Waiting for tool output...</p>
    <p style="color:#9ca3af;font-size:0.75rem;">Tool: <code>${safeToolName}</code></p>
  </div>
</div>
<script>
(function() {
  var bridge = window.FrontMcpBridge;
  if (bridge && typeof bridge.onToolResult === 'function') {
    bridge.onToolResult(function(data) {
      var root = document.getElementById('root');
      if (root && data) {
        // textContent, not innerHTML: the previous version escaped only < and >, leaving
        // the rendered JSON wrong wherever the data contained an entity, and relying on a
        // hand-rolled replace for safety (GHSA-rhr9-vhpf-jqp7).
        var pre = document.createElement('pre');
        pre.setAttribute('style', 'font-family:monospace;white-space:pre-wrap;padding:1rem;');
        pre.textContent = JSON.stringify(data, null, 2);
        root.replaceChildren(pre);
      }
    });
  }
})();
</script>`;

  const result = buildShell(content, {
    toolName,
    includeBridge: false, // Bridge already included via inline script above
    title: `Widget: ${toolName}`,
  });

  return result.html;
}
