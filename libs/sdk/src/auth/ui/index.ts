/**
 * Auth UI Module
 *
 * Server-rendered UI templates for OAuth flows using HTMX
 * with Tailwind CSS (CDN) and Google Fonts.
 *
 * No build step required - all rendering is done at runtime.
 * HTMX provides progressive enhancement for interactivity (~14KB).
 */

// Base layout exports
export {
  CDN,
  DEFAULT_THEME,
  type ThemeColors,
  type ThemeFonts,
  type ThemeConfig,
  type BaseLayoutOptions,
  baseLayout,
  createLayout,
  authLayout,
  centeredCardLayout,
  wideLayout,
  extraWideLayout,
  escapeHtml,
} from './base-layout';

// Template builder exports
export {
  // Types
  type AppAuthCard,
  type ProviderCard,
  type ToolCard,
  // Template builders
  buildConsentPage,
  buildIncrementalAuthPage,
  buildFederatedLoginPage,
  buildToolConsentPage,
  buildLoginPage,
  buildErrorPage,
  // Utility functions
  renderToHtml,
} from './htmx-templates';
