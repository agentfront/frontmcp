/**
 * UI Resource Templates for ui:// URIs
 *
 * Two URI patterns are supported:
 *
 * 1. Static Widget URI: ui://widget/{toolName}.html
 *    - Used by OpenAI at discovery/listing time
 *    - Returns the latest cached HTML for the tool
 *
 * 2. Dynamic Result URI: ui://tools/{toolName}/result/{requestId}
 *    - Used for specific tool invocation results
 *    - Returns HTML for a specific request
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
 * When OpenAI fetches this resource, we return the latest cached HTML for the tool.
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

/**
 * Dynamic Result Resource Template.
 *
 * URI format: ui://tools/{toolName}/result/{requestId}
 *
 * This template is for specific tool invocation results with unique request IDs.
 */
export const ToolUIResourceTemplate = resourceTemplate({
  name: 'tool-ui-widget',
  description: 'Rendered widget HTML for tool results with UI configurations',
  uriTemplate: 'ui://tools/{toolName}/result/{requestId}',
  mimeType: 'text/html+skybridge',
})((uri, params) => {
  // This handler should NOT be called because ReadResourceFlow
  // intercepts ui:// URIs in the findResource stage before reaching
  // the resource instance execute method.
  return {
    contents: [
      {
        uri,
        mimeType: 'text/html+skybridge',
        text: `<!DOCTYPE html>
<html>
<head>
  <title>UI Resource Error</title>
  <style>
    body { font-family: system-ui; padding: 20px; color: #721c24; background: #f8d7da; }
    .error { max-width: 600px; margin: 0 auto; }
    code { background: #f5c6cb; padding: 2px 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <div class="error">
    <h2>UI Resource Handler Error</h2>
    <p>This resource template's execute handler was called directly, which should not happen.</p>
    <p>UI resources should be intercepted by <code>ReadResourceFlow</code> and served from <code>ToolUIRegistry</code> cache.</p>
    <p><strong>URI:</strong> <code>${escapeHtml(String(uri))}</code></p>
    <p><strong>Tool:</strong> <code>${escapeHtml(String(params['toolName'] || 'unknown'))}</code></p>
    <p><strong>Request ID:</strong> <code>${escapeHtml(String(params['requestId'] || 'unknown'))}</code></p>
  </div>
</body>
</html>`,
      },
    ],
  };
});
