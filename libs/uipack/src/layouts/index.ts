/**
 * Layouts Module
 *
 * Provides base layouts and page-specific presets for FrontMCP UI.
 */

// Base layout
export {
  type PageType,
  type LayoutSize,
  type BackgroundStyle,
  type LayoutAlignment,
  type BaseLayoutOptions,
  baseLayout,
  createLayoutBuilder,
  escapeHtml,
} from './base';

// Layout presets
export {
  type AuthLayoutOptions,
  type ConsentLayoutOptions,
  type ErrorLayoutOptions,
  type LoadingLayoutOptions,
  type SuccessLayoutOptions,
  type WidgetLayoutOptions,
  authLayout,
  consentLayout,
  errorLayout,
  loadingLayout,
  successLayout,
  widgetLayout,
  authLayoutBuilder,
  consentLayoutBuilder,
  errorLayoutBuilder,
} from './presets';
