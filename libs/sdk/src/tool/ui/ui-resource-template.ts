/**
 * UI Resource Template for ui:// URIs
 *
 * Single URI pattern for widget resources:
 *
 * Static Widget URI: ui://widget/{toolName}.html
 *   - Used by OpenAI at discovery/listing time
 *   - Returns the pre-compiled static HTML for the tool
 *   - Widget reads tool output from platform context (e.g., window.openai.toolOutput)
 *
 * The actual read logic is handled by ReadResourceFlow's ui:// interception
 * in read-resource.flow.ts.
 *
 * IMPORTANT: Resources MUST be visible in resources/list for OpenAI ChatGPT
 * to discover and render widgets.
 */

import { resourceTemplate } from '../../common/decorators/resource.decorator';
import { escapeHtml } from './template-helpers';

/**
 * Static Widget Resource Template for OpenAI discovery.
 *
 * URI format: ui://widget/{toolName}.html
 *
 * This is the format OpenAI expects in tools/list _meta.openai/outputTemplate.
 * When OpenAI fetches this resource, we return the pre-compiled static HTML for the tool.
 *
 * The widget includes:
 * - FrontMCP Bridge for reading tool output from platform context
 * - CDN scripts for React/MDX/etc (based on uiType)
 * - Pre-transpiled component embedded in HTML
 *
 * At runtime, the widget reads tool output from:
 * - OpenAI: window.openai.toolOutput
 * - Generic: window.__mcpToolOutput
 */
export const StaticWidgetResourceTemplate = resourceTemplate({
  name: 'static-widget',
  description: 'Static widget HTML for tool UI (OpenAI discovery)',
  uriTemplate: 'ui://widget/{toolName}.html',
  mimeType: 'text/html+skybridge',
})((uri, params) => {
  // This handler should NOT be called because ReadResourceFlow
  // intercepts ui:// URIs before reaching the resource instance.
  return {
    contents: [
      {
        uri,
        mimeType: 'text/html+skybridge',
        text: `<!DOCTYPE html>
<html>
<head><title>Widget Placeholder</title></head>
<body>
  <p>Widget for tool: ${escapeHtml(String(params['toolName'] || 'unknown'))}</p>
  <p>This is a placeholder. The actual widget HTML is served from the ToolUIRegistry cache.</p>
</body>
</html>`,
      },
    ],
  };
});
