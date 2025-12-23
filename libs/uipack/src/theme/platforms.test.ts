import {
  OPENAI_PLATFORM,
  CLAUDE_PLATFORM,
  GEMINI_PLATFORM,
  CUSTOM_PLATFORM,
  getPlatform,
  createPlatform,
  canUseCdn,
  needsInlineScripts,
  getFallbackMode,
  PlatformCapabilities,
} from './platforms';

describe('Platform System', () => {
  describe('Platform Presets', () => {
    describe('OPENAI_PLATFORM', () => {
      it('should have correct capabilities', () => {
        expect(OPENAI_PLATFORM.id).toBe('openai');
        expect(OPENAI_PLATFORM.supportsWidgets).toBe(true);
        expect(OPENAI_PLATFORM.supportsTailwind).toBe(true);
        expect(OPENAI_PLATFORM.supportsHtmx).toBe(true);
        expect(OPENAI_PLATFORM.networkMode).toBe('full');
        expect(OPENAI_PLATFORM.scriptStrategy).toBe('cdn');
      });
    });

    describe('CLAUDE_PLATFORM', () => {
      it('should have blocked network and inline scripts', () => {
        expect(CLAUDE_PLATFORM.id).toBe('claude');
        expect(CLAUDE_PLATFORM.supportsWidgets).toBe(false);
        expect(CLAUDE_PLATFORM.supportsTailwind).toBe(true);
        expect(CLAUDE_PLATFORM.supportsHtmx).toBe(false);
        expect(CLAUDE_PLATFORM.networkMode).toBe('limited');
        expect(CLAUDE_PLATFORM.scriptStrategy).toBe('cdn');
      });
    });

    describe('GEMINI_PLATFORM', () => {
      it('should have limited widget support', () => {
        expect(GEMINI_PLATFORM.id).toBe('gemini');
        expect(GEMINI_PLATFORM.supportsWidgets).toBe(false);
        expect(GEMINI_PLATFORM.supportsTailwind).toBe(true);
        expect(GEMINI_PLATFORM.supportsHtmx).toBe(true);
        expect(GEMINI_PLATFORM.networkMode).toBe('limited');
        expect(CLAUDE_PLATFORM.scriptStrategy).toBe('cdn');
      });

      it('should have markdown fallback option', () => {
        expect(GEMINI_PLATFORM.options?.['fallback']).toBe('markdown');
      });
    });

    describe('CUSTOM_PLATFORM', () => {
      it('should have default full capabilities', () => {
        expect(CUSTOM_PLATFORM.id).toBe('custom');
        expect(CUSTOM_PLATFORM.supportsWidgets).toBe(true);
        expect(CUSTOM_PLATFORM.supportsTailwind).toBe(true);
        expect(CUSTOM_PLATFORM.supportsHtmx).toBe(true);
      });
    });
  });

  describe('getPlatform', () => {
    it('should return OpenAI platform', () => {
      const platform = getPlatform('openai');
      expect(platform).toEqual(OPENAI_PLATFORM);
    });

    it('should return Claude platform', () => {
      const platform = getPlatform('claude');
      expect(platform).toEqual(CLAUDE_PLATFORM);
    });

    it('should return Gemini platform', () => {
      const platform = getPlatform('gemini');
      expect(platform).toEqual(GEMINI_PLATFORM);
    });

    it('should return Custom platform for custom id', () => {
      const platform = getPlatform('custom');
      expect(platform).toEqual(CUSTOM_PLATFORM);
    });
  });

  describe('createPlatform', () => {
    it('should create a custom platform based on preset', () => {
      const platform = createPlatform({
        id: 'openai',
        name: 'My OpenAI App',
      });
      expect(platform.id).toBe('openai');
      expect(platform.name).toBe('My OpenAI App');
      expect(platform.supportsWidgets).toBe(true);
    });

    it('should allow capability overrides', () => {
      const platform = createPlatform({
        id: 'custom',
        name: 'No HTMX Platform',
        supportsHtmx: false,
        networkMode: 'blocked',
      });
      expect(platform.supportsHtmx).toBe(false);
      expect(platform.networkMode).toBe('blocked');
    });
  });

  describe('canUseCdn', () => {
    it('should return true for platforms with full network and cdn strategy', () => {
      expect(canUseCdn(OPENAI_PLATFORM)).toBe(true);
    });

    it('should return false for platforms with blocked network', () => {
      expect(canUseCdn(CLAUDE_PLATFORM)).toBe(false);
    });

    it('should return false for platforms with inline strategy', () => {
      expect(canUseCdn(GEMINI_PLATFORM)).toBe(false);
    });
  });

  describe('needsInlineScripts', () => {
    it('should return true for inline script strategy', () => {
      expect(needsInlineScripts(CLAUDE_PLATFORM)).toBe(true);
    });

    it('should return false for cdn script strategy with full network', () => {
      expect(needsInlineScripts(OPENAI_PLATFORM)).toBe(false);
    });

    it('should return true for blocked network mode', () => {
      expect(needsInlineScripts(GEMINI_PLATFORM)).toBe(true);
    });
  });

  describe('getFallbackMode', () => {
    it('should return html for platforms with widgets and tailwind', () => {
      expect(getFallbackMode(OPENAI_PLATFORM)).toBe('html');
    });

    it('should return markdown when platform has fallback option set', () => {
      // GEMINI_PLATFORM has fallback: 'markdown' in options
      expect(getFallbackMode(GEMINI_PLATFORM)).toBe('markdown');
    });

    it('should return text for platforms without fallback option', () => {
      const platform: PlatformCapabilities = {
        id: 'custom',
        name: 'Plain Text Platform',
        supportsWidgets: false,
        supportsTailwind: false,
        supportsHtmx: false,
        networkMode: 'blocked',
        scriptStrategy: 'inline',
        // No options.fallback set
      };
      expect(getFallbackMode(platform)).toBe('text');
    });
  });
});
