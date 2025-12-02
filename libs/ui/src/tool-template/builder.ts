/**
 * Tool Template Builder
 *
 * Provides utilities for building and rendering tool UI templates
 * with the MCP Bridge runtime.
 */

import type { TemplateContext, TemplateBuilderFn, ToolUIConfig, UIContentSecurityPolicy } from '../runtime/types';
import { createTemplateHelpers, wrapToolUI, type WrapToolUIFullOptions } from '../runtime/wrapper';
import type { ThemeConfig, PlatformCapabilities, DeepPartial } from '../theme';
import { escapeHtml } from '../layouts/base';

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
 * Execute a template builder function or return static template
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
 * Render a tool UI template to a complete HTML document.
 *
 * This is the main entry point for rendering tool UIs. It:
 * 1. Builds the template context with input/output/helpers
 * 2. Executes the template builder function
 * 3. Wraps the content in a complete HTML document with MCP Bridge
 * 4. Applies CSP and theme configuration
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

  // Execute template to get content HTML
  const content = executeTemplate(ui.template, ctx);

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
