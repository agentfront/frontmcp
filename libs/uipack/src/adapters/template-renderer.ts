/**
 * Template Renderer
 *
 * Core rendering function that executes templates and wraps results.
 *
 * @packageDocumentation
 */

import { renderComponent } from '../component/renderer';
import type { FileSource } from '../component/types';
import type { ImportResolver } from '../resolver/types';
import { buildShell } from '../shell/builder';
import { createTemplateHelpers, hasSizing } from '../shell/data-injector';
import { isTrustedHtml } from '../shell/trusted-html';
import type { WidgetSizing } from '../shell/types';
import { escapeHtml } from '../utils';
import { MCP_APPS_MIME_TYPE } from './constants';
import { detectContentType } from './content-detector';
import { wrapDetectedContent } from './content-renderers';
import { markdownToHtml } from './markdown';
import { detectUIType } from './type-detector';

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
  /** The template — FileSource, function, or string */
  template: unknown;
  /** Platform type for rendering decisions */
  platformType?: string;
  /** Optional import resolver with CDN overrides */
  resolver?: ImportResolver;
  /**
   * Resource loading mode. When `'inline'` and the template is a FileSource
   * `.tsx`/`.jsx`, React is bundled into the output (no esm.sh import map)
   * so the widget is fully self-contained — required for hosts that block
   * external script execution like Claude (#454). Default `'cdn'`.
   */
  resourceMode?: 'cdn' | 'inline';
  /**
   * Widget sizing config (preferred/min/max height, aspect-ratio, auto-resize).
   * Drives the static sizing CSS + `window.__mcpWidgetSizing` injection in the
   * shell, and is mirrored onto the returned `meta` as `ui/preferredHeight` etc.
   */
  sizing?: WidgetSizing;
  /**
   * Extra origins the widget may load from (`resourceDomains`) or call (`connectDomains`), from the
   * tool's `ui.csp`. Merged into the page's own Content-Security-Policy on every template path.
   */
  csp?: { connectDomains?: string[]; resourceDomains?: string[] };
  /**
   * HTML-escape a plain string returned by a template function; results built with
   * `html` / `trustedHtml` stay markup. When unset, strings that look like HTML render as
   * markup and a one-time notice per tool is logged; `false` keeps that without the notice.
   */
  escapeStringResults?: boolean;
  /** Receives the one-time string-result notice. Defaults to `console`. */
  logger?: { warn: (message: string) => void };
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

function buildCspConfig(resolver?: ImportResolver, extra?: RenderToolTemplateOptions['csp']) {
  const cspResourceDomains = ['https://esm.sh'];
  const cspConnectDomains = ['https://esm.sh'];
  for (const domain of extra?.resourceDomains ?? []) {
    if (!cspResourceDomains.includes(domain)) cspResourceDomains.push(domain);
  }
  for (const domain of extra?.connectDomains ?? []) {
    if (!cspConnectDomains.includes(domain)) cspConnectDomains.push(domain);
  }
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
  return { resourceDomains: cspResourceDomains, connectDomains: cspConnectDomains };
}

const STRING_RESULT_DOCS = 'https://docs.agentfront.dev/frontmcp/guides/building-tool-ui#trusted-markup';

const noticedStringResultTools = new Set<string>();

function noticeStringResult(toolName: string, logger: { warn: (message: string) => void }): void {
  if (noticedStringResultTools.has(toolName)) return;
  noticedStringResultTools.add(toolName);
  logger.warn(
    `[frontmcp] The UI template of tool "${toolName}" returned a plain string containing markup, which is rendered as HTML. ` +
      'FrontMCP 1.9 will HTML-escape plain string results by default. Build the markup with ctx.helpers.html`…` ' +
      '(interpolated values are escaped) or wrap safe markup with ctx.helpers.trustedHtml(), then set ' +
      'ui.escapeStringResults: true (or escapeStringResults: false to keep the current behaviour without this notice). ' +
      `See ${STRING_RESULT_DOCS}`,
  );
}

/**
 * Body markup for a template result no content renderer claimed.
 *
 * `TrustedHtml` is the template's own markup. A plain string detected as HTML is markup unless
 * `escapeStringResults` is on. Text and serialized values carry tool data, so they are escaped
 * (GHSA-rhr9-vhpf-jqp7).
 */
function renderUnwrappedResult(rawResult: unknown, options: RenderToolTemplateOptions): string {
  if (isTrustedHtml(rawResult)) {
    return String(rawResult);
  }
  if (typeof rawResult !== 'string') {
    return `<pre>${escapeHtml(JSON.stringify(rawResult, null, 2))}</pre>`;
  }
  if (detectContentType(rawResult) !== 'html' || options.escapeStringResults === true) {
    return escapeHtml(rawResult);
  }
  if (options.escapeStringResults === undefined) {
    noticeStringResult(options.toolName, options.logger ?? console);
  }
  return rawResult;
}

function isReactElement(value: unknown): boolean {
  return typeof value === 'object' && value !== null && '$$typeof' in value;
}

function isDefinitelyReactComponent(template: unknown): boolean {
  if (typeof template !== 'function') return false;
  const proto = (template as { prototype?: { render?: unknown } }).prototype;
  return (
    typeof proto?.render === 'function' || (template as unknown as Record<string, unknown>)['$$typeof'] !== undefined
  );
}

/**
 * Render a tool template into HTML.
 *
 * Supported template types:
 * - FileSource object `{ file: './widget.tsx' }` — bundled with esbuild, React loaded from esm.sh
 * - HTML template builder function `(ctx) => string | TrustedHtml`
 * - Static HTML/MDX string
 *
 * React function references (`template: MyComponent`) are NOT supported for bundling.
 * Use `template: { file: './my-component.tsx' }` instead.
 */
export function renderToolTemplate(options: RenderToolTemplateOptions): RenderToolTemplateResult {
  const { toolName, input, output, template, resolver, platformType, sizing } = options;
  const uiType = detectUIType(template);

  // When the user didn't pick a resourceMode, host-detect: Claude widget
  // iframes block all external script execution (esm.sh, cdnjs — see #447),
  // so `.tsx` / `.jsx` FileSource widgets only render under
  // `resourceMode: 'inline'`. Other hosts (OpenAI Apps SDK, ChatGPT, Cursor,
  // MCP Inspector) accept the smaller CDN-loaded payload. This is the (B)
  // half of #456; the (A) half (`resourceMode: 'inline'` actually inlining
  // React) shipped in #454.
  const resourceMode: 'cdn' | 'inline' = options.resourceMode ?? (platformType === 'claude' ? 'inline' : 'cdn');

  const shellConfig = {
    toolName,
    input,
    output,
    includeBridge: true,
    resolver,
    sizing,
    csp: options.csp ? buildCspConfig(resolver, options.csp) : undefined,
  };

  let html: string;
  let hash = '';
  let size = 0;

  if (typeof template === 'object' && template !== null && 'file' in template) {
    // FileSource object — delegate to component renderer.
    // When the user set `resourceMode: 'inline'`, propagate it as `inlineReact`
    // so the bundler inlines React (fix for #454: makes Claude render the widget).
    const result = renderComponent(
      { source: template as FileSource, inlineReact: resourceMode === 'inline' },
      { ...shellConfig, csp: buildCspConfig(resolver, options.csp) },
    );
    html = result.html;
    hash = result.hash;
    size = result.size;
  } else if (typeof template === 'function') {
    const helpers = createTemplateHelpers();
    const ctx = { input, output, helpers };

    // A capitalized name only *suggests* a React component. A real one (class, memo/forwardRef, or
    // anything that throws or returns an element when called outside React) cannot be bundled from a
    // reference; a capitalized plain builder is still an HTML builder and must render.
    let rawResult: unknown;
    let isHtmlBuilder = uiType !== 'react' || !isDefinitelyReactComponent(template);
    if (isHtmlBuilder) {
      try {
        rawResult = (template as (ctx: unknown) => unknown)(ctx);
        isHtmlBuilder = !isReactElement(rawResult);
      } catch (error) {
        if (uiType !== 'react') throw error;
        isHtmlBuilder = false;
      }
    }

    if (!isHtmlBuilder) {
      (options.logger ?? console).warn(
        `[FrontMCP] Tool "${toolName}": \`ui.template\` is a React component reference, which cannot be bundled ` +
          `(there is no source file to compile), so the widget would render an empty page. ` +
          `Use \`template: { file: './widget.tsx' }\` instead.`,
      );
      const shellResult = buildShell('<div id="root"></div>', shellConfig);
      html = shellResult.html;
      hash = shellResult.hash;
      size = shellResult.size;
    } else {
      // Auto-detect the result type and wrap accordingly; trusted markup is always an HTML body
      const wrapped = isTrustedHtml(rawResult) ? undefined : wrapDetectedContent(rawResult);
      if (wrapped) {
        html = wrapped;
      } else {
        const shellResult = buildShell(renderUnwrappedResult(rawResult, options), shellConfig);
        html = shellResult.html;
        hash = shellResult.hash;
        size = shellResult.size;
      }
    }
  } else if (typeof template === 'string') {
    // String template — a Markdown string is converted to HTML, an HTML string is used as written
    const shellResult = buildShell(uiType === 'markdown' ? markdownToHtml(template) : template, shellConfig);
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

  // Mirror sizing config onto the response meta so hosts that read it from
  // `_meta` (rather than `__mcpWidgetSizing`) get the same hints. Only emit the
  // fields that were actually set.
  if (hasSizing(sizing)) {
    if (sizing.preferredHeight !== undefined) meta['ui/preferredHeight'] = sizing.preferredHeight;
    if (sizing.minHeight !== undefined) meta['ui/minHeight'] = sizing.minHeight;
    if (sizing.maxHeight !== undefined) meta['ui/maxHeight'] = sizing.maxHeight;
    if (sizing.aspectRatio !== undefined) meta['ui/aspectRatio'] = sizing.aspectRatio;
  }

  return {
    html,
    uiType,
    hash,
    size: size || Buffer.byteLength(html, 'utf8'),
    meta,
  };
}
