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
export {
  type DeepPartial,
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
  type CdnScriptResource,
  type ThemeCdnFonts,
  type ThemeCdnIcons,
  type ThemeCdnScripts,
  type ThemeCdnConfig,
  type ThemeConfig,
  mergeThemes,
  createTheme,
  buildThemeCss,
  buildStyleBlock,
} from './theme';
export { GITHUB_OPENAI_THEME, DEFAULT_THEME } from './presets';
//# sourceMappingURL=index.d.ts.map
