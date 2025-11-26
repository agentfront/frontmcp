/**
 * Theme Module
 *
 * Provides comprehensive theming capabilities for FrontMCP UI.
 */

// CDN configuration
export {
  CDN,
  type CdnScriptOptions,
  fetchScript,
  fetchAndCacheScripts,
  getCachedScript,
  isScriptCached,
  clearScriptCache,
  buildFontPreconnect,
  buildFontStylesheets,
  buildCdnScripts,
} from './cdn';

// Platform configurations
export {
  type PlatformId,
  type NetworkMode,
  type ScriptStrategy,
  type PlatformCapabilities,
  OPENAI_PLATFORM,
  CLAUDE_PLATFORM,
  GEMINI_PLATFORM,
  NGROK_PLATFORM,
  CUSTOM_PLATFORM,
  PLATFORM_PRESETS,
  getPlatform,
  createPlatform,
  canUseCdn,
  needsInlineScripts,
  supportsFullInteractivity,
  getFallbackMode,
} from './platforms';

// Theme configuration
export {
  type ColorScale,
  type SemanticColors,
  type SurfaceColors,
  type TextColors,
  type BorderColors,
  type ThemeColors,
  type FontFamilies,
  type FontSizes,
  type FontWeights,
  type ThemeTypography,
  type ThemeSpacing,
  type ThemeRadius,
  type ThemeShadows,
  type ButtonTokens,
  type CardTokens,
  type InputTokens,
  type ComponentTokens,
  type ThemeConfig,
  DEFAULT_THEME,
  mergeThemes,
  createTheme,
  buildThemeCss,
  buildStyleBlock,
} from './theme';
