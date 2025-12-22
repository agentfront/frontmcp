/**
 * Tool Template Module
 *
 * Provides utilities for building and rendering tool UI templates
 * that work across multiple host environments (OpenAI, Claude, ext-apps).
 *
 * Supports multiple template formats with auto-detection:
 * - HTML strings and template builder functions
 * - React components (imported from .tsx files)
 * - JSX strings (transpiled at runtime with SWC)
 * - MDX content (Markdown + JSX)
 *
 * @module @frontmcp/ui/tool-template
 */

export {
  // Types
  type RenderTemplateOptions,
  type RenderedTemplate,
  // Core rendering (sync - for HTML templates)
  buildTemplateContext,
  executeTemplate,
  renderToolTemplate,
  // Core rendering (async - for React/MDX templates)
  renderTemplate,
  renderToolTemplateAsync,
  // Factories
  createTemplate,
  createToolUI,
  // Component helpers
  container,
  heading,
  paragraph,
  keyValue,
  dataList,
  errorDisplay,
  successDisplay,
  loadingDisplay,
} from './builder';
