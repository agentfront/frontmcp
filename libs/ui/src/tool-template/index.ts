/**
 * Tool Template Module
 *
 * Provides utilities for building and rendering tool UI templates
 * that work across multiple host environments (OpenAI, Claude, ext-apps).
 *
 * @module @frontmcp/ui/tool-template
 */

export {
  // Types
  type RenderTemplateOptions,
  type RenderedTemplate,
  // Core rendering
  buildTemplateContext,
  executeTemplate,
  renderToolTemplate,
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
