import { DEFAULT_THEME, GITHUB_OPENAI_THEME, createTheme, buildThemeCss, ThemeConfig } from './theme';

describe('Theme System', () => {
  describe('DEFAULT_THEME (GitHub/OpenAI Style)', () => {
    it('should be the same as GITHUB_OPENAI_THEME', () => {
      expect(DEFAULT_THEME).toBe(GITHUB_OPENAI_THEME);
    });

    it('should have all required color properties', () => {
      expect(DEFAULT_THEME.colors.semantic).toBeDefined();
      // GitHub/OpenAI theme uses gray-black colors
      expect(DEFAULT_THEME.colors.semantic.primary).toBe('#24292f');
      expect(DEFAULT_THEME.colors.semantic.secondary).toBe('#57606a');
      expect(DEFAULT_THEME.colors.semantic.success).toBe('#1a7f37');
      expect(DEFAULT_THEME.colors.semantic.warning).toBe('#9a6700');
      expect(DEFAULT_THEME.colors.semantic.danger).toBe('#cf222e');
    });

    it('should have surface colors', () => {
      expect(DEFAULT_THEME.colors.surface).toBeDefined();
      expect(DEFAULT_THEME.colors.surface?.background).toBe('#ffffff');
      expect(DEFAULT_THEME.colors.surface?.surface).toBe('#f6f8fa');
    });

    it('should have text colors', () => {
      expect(DEFAULT_THEME.colors.text).toBeDefined();
      expect(DEFAULT_THEME.colors.text?.primary).toBe('#24292f');
      expect(DEFAULT_THEME.colors.text?.secondary).toBe('#57606a');
    });

    it('should have border colors', () => {
      expect(DEFAULT_THEME.colors.border).toBeDefined();
      expect(DEFAULT_THEME.colors.border?.default).toBe('#d0d7de');
    });

    it('should have CDN configuration', () => {
      expect(DEFAULT_THEME.cdn).toBeDefined();
      expect(DEFAULT_THEME.cdn?.fonts?.preconnect).toContain('https://fonts.googleapis.com');
      expect(DEFAULT_THEME.cdn?.scripts?.tailwind).toBeDefined();
      expect(DEFAULT_THEME.cdn?.scripts?.htmx).toBeDefined();
    });

    it('should have typography settings', () => {
      expect(DEFAULT_THEME.typography).toBeDefined();
      expect(DEFAULT_THEME.typography?.families).toBeDefined();
    });

    it('should have radius settings', () => {
      expect(DEFAULT_THEME.radius).toBeDefined();
      expect(DEFAULT_THEME.radius?.sm).toBeDefined();
      expect(DEFAULT_THEME.radius?.md).toBeDefined();
      expect(DEFAULT_THEME.radius?.lg).toBeDefined();
    });
  });

  describe('createTheme', () => {
    it('should create a theme with default values', () => {
      const theme = createTheme({});
      expect(theme.colors.semantic.primary).toBe(DEFAULT_THEME.colors.semantic.primary);
    });

    it('should override semantic colors', () => {
      const theme = createTheme({
        colors: {
          semantic: {
            primary: '#ff0000',
          },
        },
      });
      expect(theme.colors.semantic.primary).toBe('#ff0000');
      expect(theme.colors.semantic.secondary).toBe(DEFAULT_THEME.colors.semantic.secondary);
    });

    it('should set theme name', () => {
      const theme = createTheme({ name: 'My Custom Theme' });
      expect(theme.name).toBe('My Custom Theme');
    });

    it('should allow custom CSS', () => {
      const customCss = '.custom { color: red; }';
      const theme = createTheme({ customCss });
      expect(theme.customCss).toBe(customCss);
    });

    it('should allow custom variables', () => {
      const theme = createTheme({
        customVars: {
          'brand-color': '#123456',
        },
      });
      expect(theme.customVars?.['brand-color']).toBe('#123456');
    });
  });

  describe('buildThemeCss', () => {
    it('should generate CSS with color variables', () => {
      const css = buildThemeCss(DEFAULT_THEME);
      expect(css).toContain('--color-primary');
      expect(css).toContain('--color-secondary');
      expect(css).toContain('--color-success');
      expect(css).toContain('--color-danger');
      expect(css).toContain('--color-warning');
    });

    it('should include surface colors', () => {
      const css = buildThemeCss(DEFAULT_THEME);
      expect(css).toContain('--color-background');
      expect(css).toContain('--color-surface');
    });

    it('should include text colors', () => {
      const css = buildThemeCss(DEFAULT_THEME);
      expect(css).toContain('--color-text-primary');
      expect(css).toContain('--color-text-secondary');
    });

    it('should include border colors', () => {
      const css = buildThemeCss(DEFAULT_THEME);
      expect(css).toContain('--color-border');
    });

    it('should include typography variables', () => {
      const css = buildThemeCss(DEFAULT_THEME);
      expect(css).toContain('--font-sans');
    });

    it('should include radius variables', () => {
      const css = buildThemeCss(DEFAULT_THEME);
      expect(css).toContain('--radius-sm');
      expect(css).toContain('--radius-md');
      expect(css).toContain('--radius-lg');
    });

    it('should include custom variables when provided', () => {
      const theme = createTheme({
        customVars: {
          '--my-custom': '#abcdef',
        },
      });
      const css = buildThemeCss(theme);
      expect(css).toContain('--my-custom: #abcdef');
    });
  });
});
