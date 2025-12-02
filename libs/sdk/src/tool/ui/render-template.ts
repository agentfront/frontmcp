/**
 * Template Rendering
 *
 * Executes tool UI templates with proper context and helpers.
 */

import type { ToolUIConfig, TemplateContext, TemplateBuilderFn } from '../../common/metadata/tool-ui.metadata';
import { createTemplateHelpers } from './template-helpers';

/**
 * Options for rendering a tool template.
 */
export interface RenderTemplateOptions {
  /** The template configuration from the tool */
  template: TemplateBuilderFn<unknown, unknown> | string;
  /** Tool input arguments */
  input: Record<string, unknown>;
  /** Tool output (raw result from execute) */
  output: unknown;
  /** Structured content parsed from output */
  structuredContent?: unknown;
}

/**
 * Render a tool UI template.
 *
 * @param options - Template and context data
 * @returns Rendered HTML string
 * @throws Error if template execution fails
 */
export function renderToolTemplate(options: RenderTemplateOptions): string {
  const { template, input, output, structuredContent } = options;

  // If template is already a string, return it directly
  if (typeof template === 'string') {
    return template;
  }

  // Create template context with helpers
  const ctx: TemplateContext<Record<string, unknown>, unknown> = {
    input,
    output,
    structuredContent,
    helpers: createTemplateHelpers(),
  };

  // Execute the template function
  try {
    return template(ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Template rendering failed: ${message}`);
  }
}

/**
 * Check if a tool has UI configuration.
 * Uses loose typing to handle variance issues with generic tool metadata.
 */
export function hasUIConfig(metadata: { ui?: unknown }): metadata is { ui: ToolUIConfig<unknown, unknown> } {
  const ui = metadata.ui as ToolUIConfig<unknown, unknown> | undefined;
  return ui !== undefined && ui.template !== undefined;
}
