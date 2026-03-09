/**
 * Base Template
 *
 * Creates default base template for resources/read responses.
 * Uses buildShell() from uipack/shell with bridge IIFE.
 *
 * @packageDocumentation
 */

import { buildShell } from '../shell/builder';
import { generateBridgeIIFE } from '../bridge-runtime';

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

  const bridgeScript = `<script>${generateBridgeIIFE({ minify: true })}</script>`;

  const content = `
${bridgeScript}
<div id="root">
  <div style="font-family:system-ui,sans-serif;padding:1rem;color:#374151;">
    <p style="color:#6b7280;font-size:0.875rem;">Waiting for tool output...</p>
    <p style="color:#9ca3af;font-size:0.75rem;">Tool: <code>${toolName}</code></p>
  </div>
</div>
<script>
(function() {
  var bridge = window.FrontMcpBridge;
  if (bridge && typeof bridge.onToolResult === 'function') {
    bridge.onToolResult(function(data) {
      var root = document.getElementById('root');
      if (root && data) {
        root.innerHTML = '<pre style="font-family:monospace;white-space:pre-wrap;padding:1rem;">' +
          JSON.stringify(data, null, 2).replace(/</g, '&lt;').replace(/>/g, '&gt;') +
          '</pre>';
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
