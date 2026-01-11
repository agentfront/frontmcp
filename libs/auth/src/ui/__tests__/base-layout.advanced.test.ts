/**
 * Base Layout Advanced Tests
 *
 * Additional edge case tests for base layout functionality.
 */
import {
  escapeHtml,
  baseLayout,
  createLayout,
  centeredCardLayout,
  wideLayout,
  extraWideLayout,
  authLayout,
  CDN,
  DEFAULT_THEME,
  ThemeConfig,
} from '../base-layout';

describe('escapeHtml edge cases', () => {
  it('should handle string with only special characters', () => {
    expect(escapeHtml('<>&"\'//')).toBe('&lt;&gt;&amp;&quot;&#39;&#x2F;&#x2F;');
  });

  it('should handle unicode characters', () => {
    expect(escapeHtml('Hello 世界 🌍')).toBe('Hello 世界 🌍');
  });

  it('should handle very long strings', () => {
    const longString = '<'.repeat(10000);
    const escaped = escapeHtml(longString);
    expect(escaped).toBe('&lt;'.repeat(10000));
  });

  it('should handle nested HTML', () => {
    const nested = '<div><span class="test">Content</span></div>';
    const escaped = escapeHtml(nested);
    expect(escaped).not.toContain('<div>');
    expect(escaped).not.toContain('<span');
  });

  it('should handle SQL injection attempts', () => {
    const sql = "'; DROP TABLE users; --";
    const escaped = escapeHtml(sql);
    expect(escaped).toBe('&#39;; DROP TABLE users; --');
  });
});

describe('baseLayout edge cases', () => {
  it('should handle empty content', () => {
    const html = baseLayout('', { title: 'Empty' });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<body');
    expect(html).toContain('</body>');
  });

  it('should handle content with HTML entities', () => {
    const html = baseLayout('&nbsp;&copy;&reg;', { title: 'Entities' });
    expect(html).toContain('&nbsp;&copy;&reg;');
  });

  it('should handle very long title', () => {
    const longTitle = 'T'.repeat(500);
    const html = baseLayout('<div>Content</div>', { title: longTitle });
    expect(html).toContain(longTitle);
  });

  it('should handle title with HTML', () => {
    const html = baseLayout('<div>Content</div>', { title: '<b>Bold</b>' });
    expect(html).not.toContain('<b>Bold</b>');
    expect(html).toContain('&lt;b&gt;');
  });

  it('should handle multiple head extras', () => {
    const html = baseLayout('<div>Content</div>', {
      title: 'Test',
      headExtra: '<script src="a.js"></script><script src="b.js"></script>',
    });
    expect(html).toContain('<script src="a.js"></script>');
    expect(html).toContain('<script src="b.js"></script>');
  });

  it('should handle empty body class', () => {
    const html = baseLayout('<div>Content</div>', {
      title: 'Test',
      bodyClass: '',
    });
    expect(html).toContain('<body class="">');
  });

  it('should handle body class with special characters', () => {
    const html = baseLayout('<div>Content</div>', {
      title: 'Test',
      bodyClass: 'class-with-"quotes"',
    });
    expect(html).toContain('&quot;quotes&quot;');
  });

  it('should exclude both Tailwind and fonts when requested', () => {
    const html = baseLayout('<div>Content</div>', {
      title: 'Test',
      includeTailwind: false,
      includeFonts: false,
    });
    expect(html).not.toContain(CDN.tailwind);
    expect(html).not.toContain('fonts.googleapis.com');
  });

  it('should include description meta tag when provided', () => {
    const html = baseLayout('<div>Content</div>', {
      title: 'Test',
      description: 'A test description',
    });
    expect(html).toContain('<meta name="description" content="A test description">');
  });

  it('should handle description with quotes', () => {
    const html = baseLayout('<div>Content</div>', {
      title: 'Test',
      description: 'Description with "quotes"',
    });
    expect(html).toContain('&quot;quotes&quot;');
  });
});

describe('theme configuration', () => {
  it('should handle empty theme object', () => {
    const html = baseLayout('<div>Content</div>', {
      title: 'Test',
      theme: {},
    });
    // Should still have default theme colors
    expect(html).toContain('--color-primary');
  });

  it('should handle theme with only colors', () => {
    const html = baseLayout('<div>Content</div>', {
      title: 'Test',
      theme: { colors: { primary: '#111111' } },
    });
    expect(html).toContain('--color-primary: #111111');
  });

  it('should handle theme with only fonts', () => {
    const html = baseLayout('<div>Content</div>', {
      title: 'Test',
      theme: { fonts: { mono: 'Fira Code' } },
    });
    expect(html).toContain('--font-mono: Fira Code');
  });

  it('should handle theme with customVars only', () => {
    const html = baseLayout('<div>Content</div>', {
      title: 'Test',
      theme: { customVars: '--custom-size: 16px;' },
    });
    expect(html).toContain('--custom-size: 16px;');
  });

  it('should handle theme with customCss only', () => {
    const html = baseLayout('<div>Content</div>', {
      title: 'Test',
      theme: { customCss: '.custom { display: block; }' },
    });
    expect(html).toContain('.custom { display: block; }');
  });

  it('should handle undefined color values', () => {
    const theme: ThemeConfig = {
      colors: {
        primary: '#ff0000',
        secondary: undefined,
      },
    };
    const html = baseLayout('<div>Content</div>', { title: 'Test', theme });
    expect(html).toContain('--color-primary: #ff0000');
    // undefined values should not appear
    expect(html).not.toContain('--color-secondary: undefined');
  });

  it('should handle undefined font values', () => {
    const theme: ThemeConfig = {
      fonts: {
        sans: 'Arial',
        serif: undefined,
      },
    };
    const html = baseLayout('<div>Content</div>', { title: 'Test', theme });
    expect(html).toContain('--font-sans: Arial');
    expect(html).not.toContain('--font-serif: undefined');
  });

  it('should merge multiple custom colors', () => {
    const html = baseLayout('<div>Content</div>', {
      title: 'Test',
      theme: {
        colors: {
          primary: '#111',
          secondary: '#222',
          accent: '#333',
          custom1: '#444',
          custom2: '#555',
        },
      },
    });
    expect(html).toContain('--color-primary: #111');
    expect(html).toContain('--color-secondary: #222');
    expect(html).toContain('--color-accent: #333');
    expect(html).toContain('--color-custom1: #444');
    expect(html).toContain('--color-custom2: #555');
  });
});

describe('createLayout advanced', () => {
  it('should handle undefined theme in both default and options', () => {
    const layout = createLayout({});
    const html = layout('<div>Content</div>', { title: 'Test' });
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('should handle theme in defaults only', () => {
    const layout = createLayout({
      theme: { colors: { primary: '#default' } },
    });
    const html = layout('<div>Content</div>', { title: 'Test' });
    expect(html).toContain('--color-primary: #default');
  });

  it('should handle theme in options only', () => {
    const layout = createLayout({});
    const html = layout('<div>Content</div>', {
      title: 'Test',
      theme: { colors: { primary: '#option' } },
    });
    expect(html).toContain('--color-primary: #option');
  });

  it('should deep merge customVars', () => {
    const layout = createLayout({
      theme: { customVars: '--default-var: 1;' },
    });
    const html = layout('<div>Content</div>', {
      title: 'Test',
      theme: { customVars: '--option-var: 2;' },
    });
    expect(html).toContain('--option-var: 2;');
    expect(html).not.toContain('--default-var'); // overridden
  });

  it('should deep merge customCss', () => {
    const layout = createLayout({
      theme: { customCss: '.default { }' },
    });
    const html = layout('<div>Content</div>', {
      title: 'Test',
      theme: { customCss: '.option { }' },
    });
    expect(html).toContain('.option { }');
    expect(html).not.toContain('.default'); // overridden
  });
});

describe('layout wrappers', () => {
  describe('centeredCardLayout', () => {
    it('should center content vertically and horizontally', () => {
      const html = centeredCardLayout('<div>Card</div>', { title: 'Test' });
      expect(html).toContain('flex items-center justify-center');
      expect(html).toContain('p-4'); // padding
    });

    it('should constrain width', () => {
      const html = centeredCardLayout('<div>Card</div>', { title: 'Test' });
      expect(html).toContain('max-w-md');
      expect(html).toContain('w-full');
    });

    it('should use gradient background', () => {
      const html = centeredCardLayout('<div>Card</div>', { title: 'Test' });
      expect(html).toContain('bg-gradient-to-br');
      expect(html).toContain('from-primary');
      expect(html).toContain('to-secondary');
    });

    it('should preserve options', () => {
      const html = centeredCardLayout('<div>Card</div>', {
        title: 'My Title',
        description: 'My Description',
      });
      expect(html).toContain('My Title');
      expect(html).toContain('My Description');
    });
  });

  describe('wideLayout', () => {
    it('should use 2xl max width', () => {
      const html = wideLayout('<div>Wide Content</div>', { title: 'Test' });
      expect(html).toContain('max-w-2xl');
      expect(html).toContain('mx-auto');
    });

    it('should have proper spacing', () => {
      const html = wideLayout('<div>Wide Content</div>', { title: 'Test' });
      expect(html).toContain('py-8');
      expect(html).toContain('px-4');
    });

    it('should use min-h-screen', () => {
      const html = wideLayout('<div>Wide Content</div>', { title: 'Test' });
      expect(html).toContain('min-h-screen');
    });
  });

  describe('extraWideLayout', () => {
    it('should use 3xl max width', () => {
      const html = extraWideLayout('<div>Extra Wide Content</div>', { title: 'Test' });
      expect(html).toContain('max-w-3xl');
      expect(html).toContain('mx-auto');
    });

    it('should have same spacing as wideLayout', () => {
      const html = extraWideLayout('<div>Content</div>', { title: 'Test' });
      expect(html).toContain('py-8');
      expect(html).toContain('px-4');
    });
  });

  describe('authLayout', () => {
    it('should be a layout function', () => {
      expect(typeof authLayout).toBe('function');
    });

    it('should apply default body class', () => {
      const html = authLayout('<div>Auth</div>', { title: 'Test' });
      expect(html).toContain('bg-gray-50');
      expect(html).toContain('min-h-screen');
      expect(html).toContain('font-sans');
      expect(html).toContain('antialiased');
    });

    it('should allow overriding options', () => {
      const html = authLayout('<div>Auth</div>', {
        title: 'Custom Title',
        description: 'Custom Desc',
      });
      expect(html).toContain('Custom Title');
      expect(html).toContain('Custom Desc');
    });
  });
});

describe('DEFAULT_THEME', () => {
  it('should have all expected color properties', () => {
    expect(DEFAULT_THEME.colors).toHaveProperty('primary');
    expect(DEFAULT_THEME.colors).toHaveProperty('primary-dark');
    expect(DEFAULT_THEME.colors).toHaveProperty('secondary');
    expect(DEFAULT_THEME.colors).toHaveProperty('accent');
    expect(DEFAULT_THEME.colors).toHaveProperty('success');
    expect(DEFAULT_THEME.colors).toHaveProperty('warning');
    expect(DEFAULT_THEME.colors).toHaveProperty('danger');
  });

  it('should have font configuration', () => {
    expect(DEFAULT_THEME.fonts).toHaveProperty('sans');
    expect(DEFAULT_THEME.fonts!.sans).toContain('Inter');
  });

  it('should use valid hex colors', () => {
    const hexPattern = /^#[0-9a-fA-F]{6}$/;
    for (const [key, value] of Object.entries(DEFAULT_THEME.colors || {})) {
      expect(value).toMatch(hexPattern);
    }
  });
});

describe('CDN configuration', () => {
  it('should have valid Tailwind URL', () => {
    expect(CDN.tailwind).toMatch(/^https:\/\//);
    expect(CDN.tailwind).toContain('tailwindcss');
  });

  it('should have valid font URLs', () => {
    expect(CDN.fonts.preconnect.length).toBeGreaterThan(0);
    for (const url of CDN.fonts.preconnect) {
      expect(url).toMatch(/^https:\/\//);
    }
    expect(CDN.fonts.stylesheet).toMatch(/^https:\/\//);
    expect(CDN.fonts.stylesheet).toContain('fonts.googleapis.com');
  });
});
