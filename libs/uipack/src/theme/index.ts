/**
 * @file index.ts
 * @description Theme Module for FrontMCP UI.
 *
 * Provides comprehensive theming capabilities including:
 * - Color palettes and semantic tokens
 * - Typography and spacing configuration
 * - CDN resource customization
 * - Platform-specific configurations
 * - Theme presets (GitHub/OpenAI default)
 *
 * @module @frontmcp/ui/theme
 */

// CDN configuration
export {
  CDN,
  type CdnScriptOptions,
  type ThemeCdnScriptOptions,
  fetchScript,
  fetchAndCacheScripts,
  fetchAndCacheScriptsFromTheme,
  getCachedScript,
  isScriptCached,
  clearScriptCache,
  buildFontPreconnect,
  buildFontPreconnectFromTheme,
  buildFontStylesheets,
  buildFontStylesheetsFromTheme,
  buildCdnScripts,
  buildCdnScriptsFromTheme,
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
  CUSTOM_PLATFORM,
  PLATFORM_PRESETS,
  getPlatform,
  createPlatform,
  canUseCdn,
  needsInlineScripts,
  supportsFullInteractivity,
  getFallbackMode,
} from './platforms';

// Theme configuration and types
export {
  // Utility types
  type DeepPartial,
  // Color types
  type ColorScale,
  type SemanticColors,
  type SurfaceColors,
  type TextColors,
  type BorderColors,
  type ThemeColors,
  // Typography types
  type FontFamilies,
  type FontSizes,
  type FontWeights,
  type ThemeTypography,
  // Spacing types
  type ThemeSpacing,
  type ThemeRadius,
  type ThemeShadows,
  // Component tokens
  type ButtonTokens,
  type CardTokens,
  type InputTokens,
  type ComponentTokens,
  // CDN configuration types
  type CdnScriptResource,
  type ThemeCdnFonts,
  type ThemeCdnIcons,
  type ThemeCdnScripts,
  type ThemeCdnConfig,
  // Main theme config
  type ThemeConfig,
  // Theme utilities
  mergeThemes,
  createTheme,
  buildThemeCss,
  buildStyleBlock,
} from './theme';

// Theme presets (includes DEFAULT_THEME)
export { GITHUB_OPENAI_THEME, DEFAULT_THEME } from './presets';
