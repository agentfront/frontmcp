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
  buildConnectPage,
  buildConnectSuccessPage,
  buildErrorPage,
  renderToHtml,
} from './templates';
export type { AppAuthCard, ProviderCard, ToolCard, LoginExtraField, ConsentHiddenField } from './templates';

// Local-login rendering helper (Checkpoint 3a)
export { renderLocalLoginPage, toLoginExtraFields } from './local-login.helper';
