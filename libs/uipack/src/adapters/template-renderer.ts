/**
 * Template Renderer
 *
 * Core rendering function that executes templates and wraps results.
 *
 * @packageDocumentation
 */

import { buildShell } from '../shell/builder';
import { createTemplateHelpers } from '../shell/data-injector';
import { renderComponent } from '../component/renderer';
import { detectUIType } from './type-detector';
import { wrapDetectedContent } from './content-renderers';
import { MCP_APPS_MIME_TYPE } from './constants';
import type { FileSource } from '../component/types';
import type { ImportResolver } from '../resolver/types';

/**
 * Options for rendering a tool template.
 */
export interface RenderToolTemplateOptions {
  /** Tool name */
  toolName: string;
  /** Tool input */
  input: unknown;
  /** Tool output */
  output: unknown;
  /** The template (function, string, or React component) */
  template: unknown;
  /** Platform type for rendering decisions */
  platformType?: string;
  /** Optional import resolver with CDN overrides */
  resolver?: ImportResolver;
}

/**
 * Result of rendering a tool template.
 */
export interface RenderToolTemplateResult {
  /** The rendered HTML string */
  html: string;
  /** The detected UI type */
  uiType: string;
  /** Content hash */
  hash: string;
  /** Size in bytes */
  size: number;
  /** Platform-specific metadata */
  meta: Record<string, unknown>;
}

/**
 * Render a tool template into HTML.
 *
 * - Function templates: Calls `template(ctx)` with createTemplateHelpers()
 * - React components: Delegates to renderComponent() from uipack/component
 * - String templates: Wraps in buildShell()
 * - Auto-detect: wraps detected content (chart, mermaid, PDF, HTML)
 */
export function renderToolTemplate(options: RenderToolTemplateOptions): RenderToolTemplateResult {
  const { toolName, input, output, template, platformType, resolver } = options;
  const uiType = detectUIType(template);

  const shellConfig = {
    toolName,
    input,
    output,
    includeBridge: true,
    resolver,
  };

  let html: string;
  let hash = '';
  let size = 0;

  if (typeof template === 'object' && template !== null && 'file' in template) {
    // FileSource object — delegate to component renderer
    const cspResourceDomains = ['https://esm.sh'];
    const cspConnectDomains = ['https://esm.sh'];

    // Extract origins from resolver override URLs for CSP
    if (resolver && 'overrides' in resolver) {
      const overrides = (resolver as { overrides?: Record<string, string> }).overrides;
      if (overrides) {
        for (const url of Object.values(overrides)) {
          try {
            const origin = new URL(url).origin;
            if (!cspResourceDomains.includes(origin)) cspResourceDomains.push(origin);
            if (!cspConnectDomains.includes(origin)) cspConnectDomains.push(origin);
          } catch {
            // skip invalid URLs
          }
        }
      }
    }

    const cspConfig = {
      resourceDomains: cspResourceDomains,
      connectDomains: cspConnectDomains,
    };
    const result = renderComponent({ source: template as FileSource }, { ...shellConfig, csp: cspConfig });
    html = result.html;
    hash = result.hash;
    size = result.size;
  } else if (typeof template === 'function') {
    // Check if it's a React component
    if (uiType === 'react') {
      // React functional component passed as function reference.
      // Cannot be called directly (hooks require React render context).
      // Generate a client-side shell with data injection for widget mounting.
      const shellResult = buildShell('<div id="root"></div>', shellConfig);
      html = shellResult.html;
      hash = shellResult.hash;
      size = shellResult.size;
    } else {
      // HTML template builder function
      const helpers = createTemplateHelpers();
      const ctx = { input, output, helpers };
      const rawResult = (template as (ctx: unknown) => unknown)(ctx);

      // Auto-detect the result type and wrap accordingly
      const wrapped = wrapDetectedContent(rawResult);
      if (wrapped) {
        html = wrapped;
      } else {
        // Plain text/json/html result — wrap in shell
        const textContent =
          typeof rawResult === 'string' ? rawResult : `<pre>${JSON.stringify(rawResult, null, 2)}</pre>`;
        const shellResult = buildShell(textContent, shellConfig);
        html = shellResult.html;
        hash = shellResult.hash;
        size = shellResult.size;
      }
    }
  } else if (typeof template === 'string') {
    // String template — wrap in shell with data injection
    const shellResult = buildShell(template, shellConfig);
    html = shellResult.html;
    hash = shellResult.hash;
    size = shellResult.size;
  } else {
    // Unknown template type — produce empty shell
    const shellResult = buildShell('<div id="root"></div>', shellConfig);
    html = shellResult.html;
    hash = shellResult.hash;
    size = shellResult.size;
  }

  // Build platform-specific meta
  const htmlKey = 'ui/html';
  const meta: Record<string, unknown> = {
    [htmlKey]: html,
    'ui/type': uiType,
    'ui/mimeType': MCP_APPS_MIME_TYPE,
  };

  return {
    html,
    uiType,
    hash,
    size: size || Buffer.byteLength(html, 'utf8'),
    meta,
  };
}
