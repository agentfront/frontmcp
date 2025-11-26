/**
 * Theme Module Index Tests
 *
 * These tests ensure all exports from the theme module are accessible.
 */
import * as themeModule from './index';

describe('Theme Module Exports', () => {
  describe('CDN exports', () => {
    it('should export CDN configuration', () => {
      expect(themeModule.CDN).toBeDefined();
      expect(themeModule.CDN.tailwind).toBeDefined();
      expect(themeModule.CDN.htmx).toBeDefined();
    });

    it('should export CDN functions', () => {
      expect(typeof themeModule.fetchScript).toBe('function');
      expect(typeof themeModule.fetchAndCacheScripts).toBe('function');
      expect(typeof themeModule.getCachedScript).toBe('function');
      expect(typeof themeModule.isScriptCached).toBe('function');
      expect(typeof themeModule.clearScriptCache).toBe('function');
      expect(typeof themeModule.buildFontPreconnect).toBe('function');
      expect(typeof themeModule.buildFontStylesheets).toBe('function');
      expect(typeof themeModule.buildCdnScripts).toBe('function');
    });
  });

  describe('Platform exports', () => {
    it('should export platform presets', () => {
      expect(themeModule.OPENAI_PLATFORM).toBeDefined();
      expect(themeModule.CLAUDE_PLATFORM).toBeDefined();
      expect(themeModule.GEMINI_PLATFORM).toBeDefined();
      expect(themeModule.NGROK_PLATFORM).toBeDefined();
      expect(themeModule.CUSTOM_PLATFORM).toBeDefined();
      expect(themeModule.PLATFORM_PRESETS).toBeDefined();
    });

    it('should export platform functions', () => {
      expect(typeof themeModule.getPlatform).toBe('function');
      expect(typeof themeModule.createPlatform).toBe('function');
      expect(typeof themeModule.canUseCdn).toBe('function');
      expect(typeof themeModule.needsInlineScripts).toBe('function');
      expect(typeof themeModule.supportsFullInteractivity).toBe('function');
      expect(typeof themeModule.getFallbackMode).toBe('function');
    });
  });

  describe('Theme exports', () => {
    it('should export default theme', () => {
      expect(themeModule.DEFAULT_THEME).toBeDefined();
      expect(themeModule.DEFAULT_THEME.colors).toBeDefined();
    });

    it('should export theme functions', () => {
      expect(typeof themeModule.mergeThemes).toBe('function');
      expect(typeof themeModule.createTheme).toBe('function');
      expect(typeof themeModule.buildThemeCss).toBe('function');
      expect(typeof themeModule.buildStyleBlock).toBe('function');
    });
  });
});
