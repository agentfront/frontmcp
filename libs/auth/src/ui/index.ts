/**
 * Auth UI Module
 *
 * Server-side HTML templates for OAuth authorization flows.
 */

// Base Layout
export {
  CDN,
  DEFAULT_THEME,
  baseLayout,
  createLayout,
  authLayout,
  centeredCardLayout,
  wideLayout,
  extraWideLayout,
  escapeHtml,
} from './base-layout';
export type { ThemeColors, ThemeFonts, ThemeConfig, BaseLayoutOptions } from './base-layout';

// Templates
export {
  buildConsentPage,
  buildIncrementalAuthPage,
  buildFederatedLoginPage,
  buildToolConsentPage,
  buildLoginPage,
  buildErrorPage,
  renderToHtml,
} from './templates';
export type { AppAuthCard, ProviderCard, ToolCard } from './templates';
