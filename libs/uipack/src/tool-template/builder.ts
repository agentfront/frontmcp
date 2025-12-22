/**
 * Tool Template Builder
 *
 * Provides utilities for building and rendering tool UI templates
 * with the MCP Bridge runtime.
 *
 * Supports multiple template types with auto-detection:
 * - HTML strings and template builder functions
 * - React components (imported or JSX strings)
 * - MDX content (Markdown + JSX)
 */

import type {
  TemplateContext,
  TemplateBuilderFn,
  ToolUIConfig,
  UIContentSecurityPolicy,
  ToolUITemplate,
} from '../runtime/types';
import { createTemplateHelpers, wrapToolUI, type WrapToolUIFullOptions } from '../runtime/wrapper';
import type { ThemeConfig, PlatformCapabilities, DeepPartial } from '../theme';
import { escapeHtml } from '../utils';
import { rendererRegistry } from '../renderers/registry';
import { detectTemplateType } from '../renderers/utils/detect';

// ============================================
// Template Builder Types
// ============================================

/**
 * Options for rendering a tool template
 */
export interface RenderTemplateOptions<In = Record<string, unknown>, Out = unknown> {
  /** UI configuration from tool metadata */
  ui: ToolUIConfig<In, Out>;

  /** Tool name */
  toolName: string;

  /** Tool input arguments */
  input: In;

  /** Tool output (raw result from execute) */
  output: Out;

  /** Structured content (parsed output for widgets) */
  structuredContent?: unknown;

  /** Theme configuration */
  theme?: DeepPartial<ThemeConfig>;

  /** Platform capabilities */
  platform?: PlatformCapabilities;
}

/**
 * Result of rendering a tool template
 */
export interface RenderedTemplate {
  /** Complete HTML document string */
  html: string;

  /** MIME type for the response */
  mimeType: string;

  /** OpenAI-specific metadata (if applicable) */
  openaiMeta?: Record<string, unknown>;
}

// ============================================
// Template Rendering
// ============================================

/**
 * Build template context from render options
 */
export function buildTemplateContext<In = Record<string, unknown>, Out = unknown>(
  input: In,
  output: Out,
  structuredContent?: unknown,
): TemplateContext<In, Out> {
  return {
    input,
    output,
    structuredContent,
    helpers: createTemplateHelpers(),
  };
}

/**
 * Execute a template builder function or return static template.
 * This is used for simple HTML templates only.
 */
export function executeTemplate<In = Record<string, unknown>, Out = unknown>(
  template: TemplateBuilderFn<In, Out> | string,
  ctx: TemplateContext<In, Out>,
): string {
  if (typeof template === 'string') {
    return template;
  }
  return template(ctx);
}

/**
 * Render a template using the appropriate renderer (auto-detected).
 *
 * This function detects the template type and routes to the appropriate
 * renderer (HTML, React, or MDX).
 *
 * @param template - The template to render
 * @param ctx - Template context with input/output/helpers
 * @param options - Additional render options
 * @returns Promise resolving to rendered HTML string
 */
export async function renderTemplate<In = Record<string, unknown>, Out = unknown>(
  template: ToolUITemplate<In, Out>,
  ctx: TemplateContext<In, Out>,
  options?: {
    hydrate?: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mdxComponents?: Record<string, any>;
  },
): Promise<{ html: string; rendererType: string }> {
  // Detect template type
  const detection = detectTemplateType(template);

  // For simple HTML templates, use direct execution (sync, faster)
  if (detection.type === 'html-function' || detection.type === 'html-string') {
    const html = typeof template === 'function' ? (template as TemplateBuilderFn<In, Out>)(ctx) : (template as string);

    return { html, rendererType: 'html' };
  }

  // For React/MDX, use the renderer registry
  try {
    const result = await rendererRegistry.render(template, ctx, {
      hydrate: options?.hydrate,
      mdxComponents: options?.mdxComponents,
    });

    return { html: result.html, rendererType: result.rendererType };
  } catch (error) {
    // Fallback to HTML if renderer fails
    console.warn(
      `[@frontmcp/ui] Renderer failed for ${detection.type}, falling back to HTML:`,
      error instanceof Error ? error.message : error,
    );

    // Try to execute as HTML template
    if (typeof template === 'function') {
      try {
        const html = (template as TemplateBuilderFn<In, Out>)(ctx);
        return { html, rendererType: 'html-fallback' };
      } catch {
        // If that fails too, return error message
        return {
          html: `<div class="error">Template rendering failed: ${
            error instanceof Error ? error.message : 'Unknown error'
          }</div>`,
          rendererType: 'error',
        };
      }
    }

    return { html: String(template), rendererType: 'html-fallback' };
  }
}

/**
 * Render a tool UI template to a complete HTML document (sync version).
 *
 * This is the sync entry point for rendering simple HTML tool UIs. It:
 * 1. Builds the template context with input/output/helpers
 * 2. Executes the template builder function
 * 3. Wraps the content in a complete HTML document with MCP Bridge
 * 4. Applies CSP and theme configuration
 *
 * Note: For React/MDX templates, use `renderToolTemplateAsync` instead.
 *
 * @param options - Render options
 * @returns Rendered template with HTML and metadata
 *
 * @example
 * ```typescript
 * const result = renderToolTemplate({
 *   ui: toolMetadata.ui,
 *   toolName: 'get_weather',
 *   input: { location: 'San Francisco' },
 *   output: { temperature: 72, conditions: 'sunny' },
 * });
 *
 * // Use result.html for the response body
 * // Use result.mimeType for Content-Type header
 * ```
 */
export function renderToolTemplate<In = Record<string, unknown>, Out = unknown>(
  options: RenderTemplateOptions<In, Out>,
): RenderedTemplate {
  const { ui, toolName, input, output, structuredContent, theme, platform } = options;

  // Build template context
  const ctx = buildTemplateContext(input, output, structuredContent);

  // Execute template to get content HTML (sync for HTML templates)
  const content = executeTemplate(ui.template as TemplateBuilderFn<In, Out> | string, ctx);

  // Build wrapper options
  const wrapperOptions: WrapToolUIFullOptions = {
    content,
    toolName,
    input: input as Record<string, unknown>,
    output,
    structuredContent,
    csp: ui.csp,
    widgetAccessible: ui.widgetAccessible,
    title: `${toolName} Result`,
    theme,
    platform,
  };

  // Wrap in complete HTML document
  const html = wrapToolUI(wrapperOptions);

  // Build OpenAI meta if widget features are used
  const openaiMeta = buildOpenAIMetaFromUI(ui as ToolUIConfig);

  return {
    html,
    mimeType: 'text/html',
    openaiMeta: Object.keys(openaiMeta).length > 0 ? openaiMeta : undefined,
  };
}

/**
 * Render a tool UI template to a complete HTML document (async version).
 *
 * This is the async entry point that supports all template types:
 * - HTML strings and template builder functions
 * - React components (imported or JSX strings)
 * - MDX content (Markdown + JSX)
 *
 * The template type is auto-detected and the appropriate renderer is used.
 *
 * @param options - Render options
 * @returns Promise resolving to rendered template with HTML and metadata
 *
 * @example React component
 * ```typescript
 * import { WeatherWidget } from './weather-widget.tsx';
 *
 * const result = await renderToolTemplateAsync({
 *   ui: { template: WeatherWidget, hydrate: true },
 *   toolName: 'get_weather',
 *   input: { location: 'San Francisco' },
 *   output: { temperature: 72, conditions: 'sunny' },
 * });
 * ```
 *
 * @example MDX content
 * ```typescript
 * const result = await renderToolTemplateAsync({
 *   ui: {
 *     template: `# Weather in {output.location}\nTemperature: {output.temperature}°F`,
 *   },
 *   toolName: 'get_weather',
 *   input: { location: 'San Francisco' },
 *   output: { temperature: 72, location: 'San Francisco' },
 * });
 * ```
 */
export async function renderToolTemplateAsync<In = Record<string, unknown>, Out = unknown>(
  options: RenderTemplateOptions<In, Out>,
): Promise<RenderedTemplate & { rendererType: string }> {
  const { ui, toolName, input, output, structuredContent, theme, platform } = options;

  // Build template context
  const ctx = buildTemplateContext(input, output, structuredContent);

  // Render template using the appropriate renderer (auto-detected)
  const { html: content, rendererType } = await renderTemplate(ui.template, ctx, {
    hydrate: ui.hydrate,
    mdxComponents: ui.mdxComponents,
  });

  // Apply custom wrapper if provided
  const wrappedContent = ui.wrapper ? ui.wrapper(content, ctx) : content;

  // Build wrapper options
  const wrapperOptions: WrapToolUIFullOptions = {
    content: wrappedContent,
    toolName,
    input: input as Record<string, unknown>,
    output,
    structuredContent,
    csp: ui.csp,
    widgetAccessible: ui.widgetAccessible,
    title: `${toolName} Result`,
    theme,
    platform,
    // Pass renderer type for framework runtime injection
    rendererType,
    hydrate: ui.hydrate,
  };

  // Wrap in complete HTML document
  const html = wrapToolUI(wrapperOptions);

  // Build OpenAI meta if widget features are used
  const openaiMeta = buildOpenAIMetaFromUI(ui as ToolUIConfig);

  return {
    html,
    mimeType: 'text/html',
    rendererType,
    openaiMeta: Object.keys(openaiMeta).length > 0 ? openaiMeta : undefined,
  };
}

/**
 * Build OpenAI-specific metadata from UI config
 */
function buildOpenAIMetaFromUI(ui: ToolUIConfig): Record<string, unknown> {
  const meta: Record<string, unknown> = {};

  if (ui.widgetAccessible) {
    meta['openai/widgetAccessible'] = true;
  }

  if (ui.widgetDescription) {
    meta['openai/widgetDescription'] = ui.widgetDescription;
  }

  if (ui.csp) {
    const cspConfig: Record<string, string[]> = {};
    if (ui.csp.connectDomains?.length) {
      cspConfig['connect_domains'] = ui.csp.connectDomains;
    }
    if (ui.csp.resourceDomains?.length) {
      cspConfig['resource_domains'] = ui.csp.resourceDomains;
    }
    if (Object.keys(cspConfig).length > 0) {
      meta['openai/widgetCSP'] = cspConfig;
    }
  }

  if (ui.displayMode && ui.displayMode !== 'inline') {
    meta['openai/displayMode'] = ui.displayMode;
  }

  return meta;
}

// ============================================
// Template Factory
// ============================================

/**
 * Create a typed template builder with automatic input/output typing.
 *
 * This is a convenience function that helps TypeScript infer the
 * correct types for template builder functions.
 *
 * @example
 * ```typescript
 * interface WeatherInput {
 *   location: string;
 * }
 *
 * interface WeatherOutput {
 *   temperature: number;
 *   conditions: string;
 * }
 *
 * const weatherTemplate = createTemplate<WeatherInput, WeatherOutput>((ctx) => `
 *   <div class="p-4">
 *     <h2>Weather in ${ctx.helpers.escapeHtml(ctx.input.location)}</h2>
 *     <p>${ctx.output.temperature}°F - ${ctx.output.conditions}</p>
 *   </div>
 * `);
 * ```
 */
export function createTemplate<In = Record<string, unknown>, Out = unknown>(
  builder: TemplateBuilderFn<In, Out>,
): TemplateBuilderFn<In, Out> {
  return builder;
}

/**
 * Create a ToolUIConfig with proper typing
 *
 * @example
 * ```typescript
 * const ui = createToolUI<WeatherInput, WeatherOutput>({
 *   template: (ctx) => `<div>${ctx.output.temperature}°F</div>`,
 *   csp: { connectDomains: ['https://api.weather.com'] },
 *   widgetAccessible: true,
 * });
 * ```
 */
export function createToolUI<In = Record<string, unknown>, Out = unknown>(
  config: ToolUIConfig<In, Out>,
): ToolUIConfig<In, Out> {
  return config;
}

// ============================================
// Template Component Helpers
// ============================================

/**
 * Create a container div with common styling
 */
export function container(content: string, className = ''): string {
  const baseClasses = 'p-4 rounded-lg bg-surface';
  return `<div class="${baseClasses} ${className}">${content}</div>`;
}

/**
 * Create a heading element
 */
export function heading(text: string, level: 1 | 2 | 3 | 4 = 2): string {
  const tag = `h${level}`;
  const classes =
    {
      1: 'text-2xl font-bold text-text-primary mb-4',
      2: 'text-xl font-semibold text-text-primary mb-3',
      3: 'text-lg font-medium text-text-primary mb-2',
      4: 'text-base font-medium text-text-secondary mb-2',
    }[level] || '';

  return `<${tag} class="${classes}">${escapeHtml(text)}</${tag}>`;
}

/**
 * Create a paragraph element
 */
export function paragraph(text: string, className = ''): string {
  return `<p class="text-text-secondary ${className}">${escapeHtml(text)}</p>`;
}

/**
 * Create a key-value display
 */
export function keyValue(key: string, value: string | number | boolean, className = ''): string {
  const displayValue = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);

  return `<div class="flex justify-between items-center py-2 border-b border-border ${className}">
    <span class="text-text-secondary">${escapeHtml(key)}</span>
    <span class="text-text-primary font-medium">${escapeHtml(displayValue)}</span>
  </div>`;
}

/**
 * Create a simple data list
 */
export function dataList(items: Array<{ key: string; value: string | number | boolean }>): string {
  const listItems = items.map((item) => keyValue(item.key, item.value)).join('');
  return `<div class="space-y-1">${listItems}</div>`;
}

/**
 * Create an error display
 */
export function errorDisplay(message: string, details?: string): string {
  return `<div class="p-4 bg-danger/10 border border-danger rounded-lg">
    <div class="flex items-center gap-2 text-danger">
      <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/>
      </svg>
      <span class="font-medium">${escapeHtml(message)}</span>
    </div>
    ${details ? `<p class="mt-2 text-sm text-text-secondary">${escapeHtml(details)}</p>` : ''}
  </div>`;
}

/**
 * Create a success display
 */
export function successDisplay(message: string, details?: string): string {
  return `<div class="p-4 bg-success/10 border border-success rounded-lg">
    <div class="flex items-center gap-2 text-success">
      <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
      </svg>
      <span class="font-medium">${escapeHtml(message)}</span>
    </div>
    ${details ? `<p class="mt-2 text-sm text-text-secondary">${escapeHtml(details)}</p>` : ''}
  </div>`;
}

/**
 * Create a loading indicator
 */
export function loadingDisplay(message = 'Loading...'): string {
  return `<div class="flex items-center justify-center p-8">
    <div class="flex items-center gap-3 text-text-secondary">
      <svg class="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      <span>${escapeHtml(message)}</span>
    </div>
  </div>`;
}
