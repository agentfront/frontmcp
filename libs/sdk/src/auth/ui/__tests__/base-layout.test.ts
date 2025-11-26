/**
 * Base Layout Tests
 *
 * Tests for the base layout with CDN resources and theming.
 */

import {
  CDN,
  DEFAULT_THEME,
  baseLayout,
  createLayout,
  authLayout,
  centeredCardLayout,
  wideLayout,
  extraWideLayout,
  escapeHtml,
  type BaseLayoutOptions,
  type ThemeConfig,
} from '../base-layout';

describe('Base Layout', () => {
  // ============================================
  // CDN Configuration Tests
  // ============================================

  describe('CDN Configuration', () => {
    it('should have Tailwind v4 browser CDN URL', () => {
      expect(CDN.tailwind).toBe('https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4');
    });

    it('should have HTMX CDN URL with integrity hash', () => {
      expect(CDN.htmx.url).toContain('htmx.org');
      expect(CDN.htmx.integrity).toContain('sha384-');
    });

    it('should have Google Fonts configuration', () => {
      expect(CDN.fonts.preconnect).toContain('https://fonts.googleapis.com');
      expect(CDN.fonts.preconnect).toContain('https://fonts.gstatic.com');
      expect(CDN.fonts.stylesheet).toContain('fonts.googleapis.com');
      expect(CDN.fonts.stylesheet).toContain('Inter');
    });
  });

  // ============================================
  // Default Theme Tests
  // ============================================

  describe('DEFAULT_THEME', () => {
    it('should have default colors', () => {
      expect(DEFAULT_THEME.colors?.primary).toBe('#3b82f6');
      expect(DEFAULT_THEME.colors?.['primary-dark']).toBe('#2563eb');
      expect(DEFAULT_THEME.colors?.secondary).toBe('#8b5cf6');
      expect(DEFAULT_THEME.colors?.accent).toBe('#06b6d4');
      expect(DEFAULT_THEME.colors?.success).toBe('#22c55e');
      expect(DEFAULT_THEME.colors?.warning).toBe('#f59e0b');
      expect(DEFAULT_THEME.colors?.danger).toBe('#ef4444');
    });

    it('should have default fonts', () => {
      expect(DEFAULT_THEME.fonts?.sans).toContain('Inter');
      expect(DEFAULT_THEME.fonts?.sans).toContain('system-ui');
    });
  });

  // ============================================
  // escapeHtml Tests
  // ============================================

  describe('escapeHtml', () => {
    it('should escape HTML special characters', () => {
      expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
      expect(escapeHtml('&')).toBe('&amp;');
      expect(escapeHtml('"')).toBe('&quot;');
      expect(escapeHtml("'")).toBe('&#39;');
    });

    it('should handle strings without special characters', () => {
      expect(escapeHtml('hello world')).toBe('hello world');
    });

    it('should handle empty strings', () => {
      expect(escapeHtml('')).toBe('');
    });

    it('should escape multiple special characters', () => {
      const input = '<script>alert("XSS & \'attack\'")</script>';
      const expected = '&lt;script&gt;alert(&quot;XSS &amp; &#39;attack&#39;&quot;)&lt;/script&gt;';
      expect(escapeHtml(input)).toBe(expected);
    });
  });

  // ============================================
  // baseLayout Tests
  // ============================================

  describe('baseLayout', () => {
    const defaultOptions: BaseLayoutOptions = {
      title: 'Test Page',
    };

    it('should include DOCTYPE and html tag', () => {
      const html = baseLayout('<div>content</div>', defaultOptions);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('</html>');
    });

    it('should include the title in the head', () => {
      const html = baseLayout('<div>content</div>', { title: 'My Title' });

      expect(html).toContain('<title>My Title - FrontMCP</title>');
    });

    it('should escape title for XSS prevention', () => {
      const html = baseLayout('<div>content</div>', { title: '<script>evil()</script>' });

      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>evil');
    });

    it('should include meta description when provided', () => {
      const html = baseLayout('<div>content</div>', {
        title: 'Test',
        description: 'A test page description',
      });

      expect(html).toContain('name="description"');
      expect(html).toContain('A test page description');
    });

    it('should include Tailwind v4 browser CDN by default', () => {
      const html = baseLayout('<div>content</div>', defaultOptions);

      expect(html).toContain('cdn.jsdelivr.net/npm/@tailwindcss/browser@4');
    });

    it('should include style type="text/tailwindcss" for theming', () => {
      const html = baseLayout('<div>content</div>', defaultOptions);

      expect(html).toContain('type="text/tailwindcss"');
      expect(html).toContain('@theme');
    });

    it('should exclude Tailwind when includeTailwind is false', () => {
      const html = baseLayout('<div>content</div>', {
        ...defaultOptions,
        includeTailwind: false,
      });

      expect(html).not.toContain('@tailwindcss/browser');
      expect(html).not.toContain('type="text/tailwindcss"');
    });

    it('should include HTMX CDN by default', () => {
      const html = baseLayout('<div>content</div>', defaultOptions);

      expect(html).toContain('htmx.org');
      expect(html).toContain('integrity=');
    });

    it('should exclude HTMX when includeHtmx is false', () => {
      const html = baseLayout('<div>content</div>', {
        ...defaultOptions,
        includeHtmx: false,
      });

      expect(html).not.toContain('htmx.org');
    });

    it('should include Google Fonts by default', () => {
      const html = baseLayout('<div>content</div>', defaultOptions);

      expect(html).toContain('fonts.googleapis.com');
      expect(html).toContain('fonts.gstatic.com');
      expect(html).toContain('Inter');
    });

    it('should exclude fonts when includeFonts is false', () => {
      const html = baseLayout('<div>content</div>', {
        ...defaultOptions,
        includeFonts: false,
      });

      expect(html).not.toContain('fonts.googleapis.com');
    });

    it('should include viewport meta tag', () => {
      const html = baseLayout('<div>content</div>', defaultOptions);

      expect(html).toContain('viewport');
      expect(html).toContain('width=device-width');
    });

    it('should use default body class', () => {
      const html = baseLayout('<div>content</div>', defaultOptions);

      expect(html).toContain('bg-gray-50');
      expect(html).toContain('min-h-screen');
      expect(html).toContain('font-sans');
      expect(html).toContain('antialiased');
    });

    it('should use custom body class when provided', () => {
      const html = baseLayout('<div>content</div>', {
        ...defaultOptions,
        bodyClass: 'bg-red-500 custom-class',
      });

      expect(html).toContain('bg-red-500');
      expect(html).toContain('custom-class');
    });

    it('should include head extra content when provided', () => {
      const html = baseLayout('<div>content</div>', {
        ...defaultOptions,
        headExtra: '<script>console.log("extra")</script>',
      });

      expect(html).toContain('<script>console.log("extra")</script>');
    });

    it('should include content in body', () => {
      const content = '<div class="my-content">Hello World</div>';
      const html = baseLayout(content, defaultOptions);

      expect(html).toContain(content);
    });
  });

  // ============================================
  // Theme Configuration Tests
  // ============================================

  describe('Theme Configuration', () => {
    it('should include default theme colors in @theme block', () => {
      const html = baseLayout('<div>content</div>', { title: 'Test' });

      expect(html).toContain('--color-primary: #3b82f6');
      expect(html).toContain('--color-primary-dark: #2563eb');
      expect(html).toContain('--color-secondary: #8b5cf6');
      expect(html).toContain('--color-success: #22c55e');
      expect(html).toContain('--color-warning: #f59e0b');
      expect(html).toContain('--color-danger: #ef4444');
    });

    it('should include default font in @theme block', () => {
      const html = baseLayout('<div>content</div>', { title: 'Test' });

      expect(html).toContain('--font-sans:');
      expect(html).toContain('Inter');
    });

    it('should override default colors with custom theme', () => {
      const html = baseLayout('<div>content</div>', {
        title: 'Test',
        theme: {
          colors: {
            primary: '#ff6b6b',
            'primary-dark': '#ee5a5a',
          },
        },
      });

      expect(html).toContain('--color-primary: #ff6b6b');
      expect(html).toContain('--color-primary-dark: #ee5a5a');
      // Other defaults should still be present
      expect(html).toContain('--color-secondary: #8b5cf6');
    });

    it('should add custom colors to theme', () => {
      const html = baseLayout('<div>content</div>', {
        title: 'Test',
        theme: {
          colors: {
            brand: '#123456',
            'brand-light': '#abcdef',
          },
        },
      });

      expect(html).toContain('--color-brand: #123456');
      expect(html).toContain('--color-brand-light: #abcdef');
    });

    it('should override default fonts with custom theme', () => {
      const html = baseLayout('<div>content</div>', {
        title: 'Test',
        theme: {
          fonts: {
            sans: 'Roboto, Arial, sans-serif',
          },
        },
      });

      expect(html).toContain('--font-sans: Roboto, Arial, sans-serif');
    });

    it('should add custom fonts to theme', () => {
      const html = baseLayout('<div>content</div>', {
        title: 'Test',
        theme: {
          fonts: {
            display: 'Playfair Display, serif',
          },
        },
      });

      expect(html).toContain('--font-display: Playfair Display, serif');
    });

    it('should include customVars in @theme block', () => {
      const html = baseLayout('<div>content</div>', {
        title: 'Test',
        theme: {
          customVars: '--spacing-huge: 10rem;',
        },
      });

      expect(html).toContain('--spacing-huge: 10rem;');
    });

    it('should include customCss outside @theme block', () => {
      const html = baseLayout('<div>content</div>', {
        title: 'Test',
        theme: {
          customCss: '.my-custom-class { color: red; }',
        },
      });

      expect(html).toContain('.my-custom-class { color: red; }');
    });

    it('should handle empty theme gracefully', () => {
      const html = baseLayout('<div>content</div>', {
        title: 'Test',
        theme: {},
      });

      // Should still include defaults
      expect(html).toContain('--color-primary: #3b82f6');
      expect(html).toContain('--font-sans:');
    });
  });

  // ============================================
  // createLayout Tests
  // ============================================

  describe('createLayout', () => {
    it('should create a layout function with default options', () => {
      const customLayout = createLayout({
        bodyClass: 'custom-body-class',
      });

      const html = customLayout('<div>content</div>', { title: 'Test' });

      expect(html).toContain('custom-body-class');
    });

    it('should allow overriding default options', () => {
      const customLayout = createLayout({
        bodyClass: 'default-class',
      });

      const html = customLayout('<div>content</div>', {
        title: 'Test',
        bodyClass: 'override-class',
      });

      expect(html).toContain('override-class');
      expect(html).not.toContain('default-class');
    });

    it('should merge themes from default and options', () => {
      const customLayout = createLayout({
        theme: {
          colors: {
            primary: '#111111',
            secondary: '#222222',
          },
        },
      });

      const html = customLayout('<div>content</div>', {
        title: 'Test',
        theme: {
          colors: {
            primary: '#333333', // Override
            accent: '#444444', // New
          },
        },
      });

      expect(html).toContain('--color-primary: #333333'); // Overridden
      expect(html).toContain('--color-secondary: #222222'); // From default
      expect(html).toContain('--color-accent: #444444'); // New from options
    });

    it('should use option customVars over default customVars', () => {
      const customLayout = createLayout({
        theme: {
          customVars: '--default-var: 1;',
        },
      });

      const html = customLayout('<div>content</div>', {
        title: 'Test',
        theme: {
          customVars: '--option-var: 2;',
        },
      });

      expect(html).toContain('--option-var: 2;');
      expect(html).not.toContain('--default-var: 1;');
    });
  });

  // ============================================
  // Pre-configured Layout Tests
  // ============================================

  describe('authLayout', () => {
    it('should create a layout with auth styling', () => {
      const html = authLayout('<div>login form</div>', { title: 'Login' });

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('login form');
      expect(html).toContain('bg-gray-50');
    });
  });

  describe('centeredCardLayout', () => {
    it('should wrap content in centered container', () => {
      const html = centeredCardLayout('<div>card content</div>', { title: 'Card' });

      expect(html).toContain('min-h-screen');
      expect(html).toContain('flex');
      expect(html).toContain('items-center');
      expect(html).toContain('justify-center');
      expect(html).toContain('max-w-md');
    });

    it('should have gradient background using theme colors', () => {
      const html = centeredCardLayout('<div>card content</div>', { title: 'Card' });

      expect(html).toContain('bg-gradient-to-br');
      expect(html).toContain('from-primary');
      expect(html).toContain('to-secondary');
    });

    it('should use custom theme colors in gradient', () => {
      const html = centeredCardLayout('<div>card content</div>', {
        title: 'Card',
        theme: {
          colors: {
            primary: '#ff0000',
            secondary: '#00ff00',
          },
        },
      });

      expect(html).toContain('--color-primary: #ff0000');
      expect(html).toContain('--color-secondary: #00ff00');
    });
  });

  describe('wideLayout', () => {
    it('should wrap content in wide container', () => {
      const html = wideLayout('<div>wide content</div>', { title: 'Wide' });

      expect(html).toContain('min-h-screen');
      expect(html).toContain('max-w-2xl');
      expect(html).toContain('mx-auto');
    });
  });

  describe('extraWideLayout', () => {
    it('should wrap content in extra wide container', () => {
      const html = extraWideLayout('<div>extra wide content</div>', { title: 'Extra Wide' });

      expect(html).toContain('min-h-screen');
      expect(html).toContain('max-w-3xl');
      expect(html).toContain('mx-auto');
    });
  });

  // ============================================
  // Integration Tests
  // ============================================

  describe('Integration', () => {
    it('should produce valid HTML structure', () => {
      const html = baseLayout('<p>test</p>', { title: 'Test' });

      // Check basic HTML structure
      expect(html).toMatch(/<html[^>]*>/);
      expect(html).toMatch(/<\/html>/);
      expect(html).toMatch(/<head>/);
      expect(html).toMatch(/<\/head>/);
      expect(html).toMatch(/<body[^>]*>/);
      expect(html).toMatch(/<\/body>/);
    });

    it('should have head before body', () => {
      const html = baseLayout('<p>test</p>', { title: 'Test' });
      const headIndex = html.indexOf('<head>');
      const bodyIndex = html.indexOf('<body');

      expect(headIndex).toBeLessThan(bodyIndex);
    });

    it('should close all tags properly', () => {
      const html = baseLayout('<p>test</p>', { title: 'Test' });

      expect(html).toContain('</head>');
      expect(html).toContain('</body>');
      expect(html).toContain('</html>');
    });

    it('should have @theme block inside style tag', () => {
      const html = baseLayout('<p>test</p>', { title: 'Test' });
      const styleStart = html.indexOf('<style type="text/tailwindcss">');
      // Find @theme that comes after the style tag, not in comments
      const themeStart = html.indexOf('@theme {');
      const styleEnd = html.indexOf('</style>');

      expect(styleStart).toBeGreaterThan(-1);
      expect(themeStart).toBeGreaterThan(-1);
      expect(styleEnd).toBeGreaterThan(-1);
      expect(styleStart).toBeLessThan(themeStart);
      expect(themeStart).toBeLessThan(styleEnd);
    });

    it('should work with complex theme configuration', () => {
      const complexTheme: ThemeConfig = {
        colors: {
          primary: '#1a1a2e',
          'primary-dark': '#16213e',
          secondary: '#0f3460',
          accent: '#e94560',
          brand: '#53354a',
        },
        fonts: {
          sans: 'Poppins, sans-serif',
          display: 'Montserrat, sans-serif',
        },
        customVars: '--radius-xl: 1.5rem;',
        customCss: '.custom-shadow { box-shadow: 0 4px 6px rgba(0,0,0,0.1); }',
      };

      const html = baseLayout('<div>content</div>', {
        title: 'Complex Theme',
        theme: complexTheme,
      });

      expect(html).toContain('--color-primary: #1a1a2e');
      expect(html).toContain('--color-accent: #e94560');
      expect(html).toContain('--color-brand: #53354a');
      expect(html).toContain('--font-sans: Poppins, sans-serif');
      expect(html).toContain('--font-display: Montserrat, sans-serif');
      expect(html).toContain('--radius-xl: 1.5rem;');
      expect(html).toContain('.custom-shadow');
    });
  });
});
