/**
 * @file serving-mode.test.ts
 * @description Tests for serving mode resolution based on client capabilities.
 */

import {
  resolveServingMode,
  isPlatformModeSupported,
  getDefaultServingMode,
  platformUsesStructuredContent,
} from '../serving-mode';

describe('Serving Mode Resolution', () => {
  describe('resolveServingMode', () => {
    describe('with auto mode (default)', () => {
      it('should select inline mode for OpenAI with structuredContent', () => {
        const result = resolveServingMode({
          configuredMode: 'auto',
          platformType: 'openai',
        });

        expect(result.effectiveMode).toBe('inline');
        expect(result.useStructuredContent).toBe(true);
        expect(result.supportsUI).toBe(true);
        expect(result.reason).toContain('Auto-selected');
      });

      it('should select inline mode for ext-apps with structuredContent', () => {
        const result = resolveServingMode({
          configuredMode: 'auto',
          platformType: 'ext-apps',
        });

        expect(result.effectiveMode).toBe('inline');
        expect(result.useStructuredContent).toBe(true);
        expect(result.supportsUI).toBe(true);
      });

      it('should select inline mode with structuredContent for Claude', () => {
        const result = resolveServingMode({
          configuredMode: 'auto',
          platformType: 'claude',
        });

        expect(result.effectiveMode).toBe('inline');
        expect(result.useStructuredContent).toBe(true);
        expect(result.supportsUI).toBe(true);
      });

      it('should skip UI for Gemini (no widget support)', () => {
        const result = resolveServingMode({
          configuredMode: 'auto',
          platformType: 'gemini',
        });

        expect(result.effectiveMode).toBe(null);
        expect(result.useStructuredContent).toBe(false);
        expect(result.supportsUI).toBe(false);
        expect(result.reason).toContain('does not support widget UI');
      });

      it('should skip UI for unknown clients (conservative default)', () => {
        const result = resolveServingMode({
          configuredMode: 'auto',
          platformType: 'unknown',
        });

        expect(result.effectiveMode).toBe(null);
        expect(result.supportsUI).toBe(false);
      });

      it('should select inline mode for Cursor with structuredContent', () => {
        const result = resolveServingMode({
          configuredMode: 'auto',
          platformType: 'cursor',
        });

        expect(result.effectiveMode).toBe('inline');
        expect(result.useStructuredContent).toBe(true);
        expect(result.supportsUI).toBe(true);
      });

      it('should select inline mode for Continue with structuredContent', () => {
        const result = resolveServingMode({
          configuredMode: 'auto',
          platformType: 'continue',
        });

        expect(result.effectiveMode).toBe('inline');
        expect(result.useStructuredContent).toBe(true);
        expect(result.supportsUI).toBe(true);
      });

      it('should select inline mode for Cody with structuredContent', () => {
        const result = resolveServingMode({
          configuredMode: 'auto',
          platformType: 'cody',
        });

        expect(result.effectiveMode).toBe('inline');
        expect(result.useStructuredContent).toBe(true);
        expect(result.supportsUI).toBe(true);
      });

      it('should select inline mode for generic-mcp with structuredContent', () => {
        const result = resolveServingMode({
          configuredMode: 'auto',
          platformType: 'generic-mcp',
        });

        expect(result.effectiveMode).toBe('inline');
        expect(result.useStructuredContent).toBe(true);
        expect(result.supportsUI).toBe(true);
      });
    });

    describe('with forced mode', () => {
      it('should use static mode for OpenAI when forced', () => {
        const result = resolveServingMode({
          configuredMode: 'static',
          platformType: 'openai',
        });

        expect(result.effectiveMode).toBe('static');
        expect(result.supportsUI).toBe(true);
        expect(result.reason).toContain("Using configured mode 'static'");
      });

      it('should use hybrid mode for ext-apps when forced', () => {
        const result = resolveServingMode({
          configuredMode: 'hybrid',
          platformType: 'ext-apps',
        });

        expect(result.effectiveMode).toBe('hybrid');
        expect(result.supportsUI).toBe(true);
      });

      it('should skip UI for Claude when static mode is forced (not supported)', () => {
        const result = resolveServingMode({
          configuredMode: 'static',
          platformType: 'claude',
        });

        expect(result.effectiveMode).toBe(null);
        expect(result.supportsUI).toBe(false);
        expect(result.reason).toContain("not supported by platform 'claude'");
      });

      it('should skip UI for Claude when hybrid mode is forced (not supported)', () => {
        const result = resolveServingMode({
          configuredMode: 'hybrid',
          platformType: 'claude',
        });

        expect(result.effectiveMode).toBe(null);
        expect(result.supportsUI).toBe(false);
      });

      it('should use inline mode for Claude when forced (supported)', () => {
        const result = resolveServingMode({
          configuredMode: 'inline',
          platformType: 'claude',
        });

        expect(result.effectiveMode).toBe('inline');
        expect(result.useStructuredContent).toBe(true);
        expect(result.supportsUI).toBe(true);
      });

      it('should skip UI for Gemini even when inline mode is forced', () => {
        const result = resolveServingMode({
          configuredMode: 'inline',
          platformType: 'gemini',
        });

        expect(result.effectiveMode).toBe(null);
        expect(result.supportsUI).toBe(false);
      });

      it('should skip UI for Continue when static mode is forced (not supported)', () => {
        const result = resolveServingMode({
          configuredMode: 'static',
          platformType: 'continue',
        });

        expect(result.effectiveMode).toBe(null);
        expect(result.supportsUI).toBe(false);
        expect(result.reason).toContain("not supported by platform 'continue'");
      });
    });

    describe('default configuredMode', () => {
      it('should default to auto when configuredMode is not specified', () => {
        const result = resolveServingMode({
          platformType: 'openai',
        });

        expect(result.effectiveMode).toBe('inline');
        expect(result.supportsUI).toBe(true);
      });
    });
  });

  describe('isPlatformModeSupported', () => {
    it('should return true for supported modes', () => {
      expect(isPlatformModeSupported('openai', 'inline')).toBe(true);
      expect(isPlatformModeSupported('openai', 'static')).toBe(true);
      expect(isPlatformModeSupported('openai', 'hybrid')).toBe(true);
      expect(isPlatformModeSupported('claude', 'inline')).toBe(true);
    });

    it('should return false for unsupported modes', () => {
      expect(isPlatformModeSupported('claude', 'static')).toBe(false);
      expect(isPlatformModeSupported('claude', 'hybrid')).toBe(false);
      expect(isPlatformModeSupported('gemini', 'inline')).toBe(false);
    });

    it('should return true for auto mode if platform supports widgets', () => {
      expect(isPlatformModeSupported('openai', 'auto')).toBe(true);
      expect(isPlatformModeSupported('claude', 'auto')).toBe(true);
    });

    it('should return false for auto mode if platform does not support widgets', () => {
      expect(isPlatformModeSupported('gemini', 'auto')).toBe(false);
      expect(isPlatformModeSupported('unknown', 'auto')).toBe(false);
    });
  });

  describe('getDefaultServingMode', () => {
    it('should return inline for platforms with widget support', () => {
      expect(getDefaultServingMode('openai')).toBe('inline');
      expect(getDefaultServingMode('claude')).toBe('inline');
      expect(getDefaultServingMode('cursor')).toBe('inline');
    });

    it('should return null for platforms without widget support', () => {
      expect(getDefaultServingMode('gemini')).toBe(null);
      expect(getDefaultServingMode('unknown')).toBe(null);
    });
  });

  describe('platformUsesStructuredContent', () => {
    it('should return true for all widget-supporting platforms', () => {
      expect(platformUsesStructuredContent('openai')).toBe(true);
      expect(platformUsesStructuredContent('ext-apps')).toBe(true);
      expect(platformUsesStructuredContent('claude')).toBe(true);
      expect(platformUsesStructuredContent('cursor')).toBe(true);
      expect(platformUsesStructuredContent('continue')).toBe(true);
      expect(platformUsesStructuredContent('cody')).toBe(true);
      expect(platformUsesStructuredContent('generic-mcp')).toBe(true);
    });

    it('should return false for non-widget platforms', () => {
      expect(platformUsesStructuredContent('gemini')).toBe(false);
      expect(platformUsesStructuredContent('unknown')).toBe(false);
    });
  });
});
