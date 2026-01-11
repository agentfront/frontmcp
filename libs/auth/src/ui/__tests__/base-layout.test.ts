/**
 * Base Layout Tests
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
} from '../base-layout';

describe('escapeHtml', () => {
  it('should escape ampersand', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
  });

  it('should escape less than', () => {
    expect(escapeHtml('foo < bar')).toBe('foo &lt; bar');
  });

  it('should escape greater than', () => {
    expect(escapeHtml('foo > bar')).toBe('foo &gt; bar');
  });

  it('should escape double quotes', () => {
    expect(escapeHtml('foo "bar"')).toBe('foo &quot;bar&quot;');
  });

  it('should escape single quotes', () => {
    expect(escapeHtml("foo 'bar'")).toBe('foo &#39;bar&#39;');
  });

  it('should escape forward slashes', () => {
    expect(escapeHtml('foo / bar')).toBe('foo &#x2F; bar');
  });

  it('should escape all special characters together', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;',
    );
  });

  it('should handle empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('should handle string with no special characters', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('should escape XSS attack vectors', () => {
    const attacks = [
      '<img src=x onerror=alert(1)>',
      '"><script>alert(1)</script>',
      "javascript:alert('xss')",
      '<svg onload=alert(1)>',
    ];

    for (const attack of attacks) {
      const escaped = escapeHtml(attack);
      expect(escaped).not.toContain('<');
      expect(escaped).not.toContain('>');
    }
  });
});

describe('CDN', () => {
  it('should have Tailwind CDN URL', () => {
    expect(CDN.tailwind).toBe('https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4');
  });

  it('should have Google Fonts configuration', () => {
    expect(CDN.fonts.preconnect).toContain('https://fonts.googleapis.com');
    expect(CDN.fonts.preconnect).toContain('https://fonts.gstatic.com');
    expect(CDN.fonts.stylesheet).toContain('fonts.googleapis.com');
  });
});

describe('DEFAULT_THEME', () => {
  it('should have color definitions', () => {
    expect(DEFAULT_THEME.colors).toBeDefined();
    expect(DEFAULT_THEME.colors?.primary).toBe('#3b82f6');
    expect(DEFAULT_THEME.colors?.['primary-dark']).toBe('#2563eb');
    expect(DEFAULT_THEME.colors?.secondary).toBe('#8b5cf6');
    expect(DEFAULT_THEME.colors?.accent).toBe('#06b6d4');
    expect(DEFAULT_THEME.colors?.success).toBe('#22c55e');
    expect(DEFAULT_THEME.colors?.warning).toBe('#f59e0b');
    expect(DEFAULT_THEME.colors?.danger).toBe('#ef4444');
  });

  it('should have font definitions', () => {
    expect(DEFAULT_THEME.fonts).toBeDefined();
    expect(DEFAULT_THEME.fonts?.sans).toContain('Inter');
  });
});

describe('baseLayout', () => {
  it('should generate valid HTML document', () => {
    const html = baseLayout('<div>Content</div>', { title: 'Test Page' });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<head>');
    expect(html).toContain('</head>');
    expect(html).toContain('<body');
    expect(html).toContain('</body>');
    expect(html).toContain('</html>');
  });

  it('should include title in head', () => {
    const html = baseLayout('<div>Content</div>', { title: 'My Page' });

    expect(html).toContain('<title>My Page - FrontMCP</title>');
  });

  it('should escape title for XSS protection', () => {
    const html = baseLayout('<div>Content</div>', { title: '<script>alert(1)</script>' });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should include content in body', () => {
    const html = baseLayout('<div class="test">Hello World</div>', { title: 'Test' });

    expect(html).toContain('<div class="test">Hello World</div>');
  });

  it('should include Tailwind CSS by default', () => {
    const html = baseLayout('<div>Content</div>', { title: 'Test' });

    expect(html).toContain(CDN.tailwind);
    expect(html).toContain('<style type="text/tailwindcss">');
    expect(html).toContain('@theme');
  });

  it('should exclude Tailwind CSS when includeTailwind is false', () => {
    const html = baseLayout('<div>Content</div>', { title: 'Test', includeTailwind: false });

    expect(html).not.toContain(CDN.tailwind);
    expect(html).not.toContain('<style type="text/tailwindcss">');
  });

  it('should include Google Fonts by default', () => {
    const html = baseLayout('<div>Content</div>', { title: 'Test' });

    expect(html).toContain('fonts.googleapis.com');
    expect(html).toContain('fonts.gstatic.com');
    expect(html).toContain('rel="preconnect"');
  });

  it('should exclude Google Fonts when includeFonts is false', () => {
    const html = baseLayout('<div>Content</div>', { title: 'Test', includeFonts: false });

    expect(html).not.toContain('fonts.googleapis.com');
  });

  it('should include meta description when provided', () => {
    const html = baseLayout('<div>Content</div>', {
      title: 'Test',
      description: 'Test description',
    });

    expect(html).toContain('<meta name="description" content="Test description">');
  });

  it('should escape meta description', () => {
    const html = baseLayout('<div>Content</div>', {
      title: 'Test',
      description: '<script>alert("xss")</script>',
    });

    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<meta[^>]*content="[^"]*<script>/);
  });

  it('should apply custom body class', () => {
    const html = baseLayout('<div>Content</div>', {
      title: 'Test',
      bodyClass: 'custom-class bg-red-500',
    });

    expect(html).toContain('<body class="custom-class bg-red-500">');
  });

  it('should include headExtra content', () => {
    const html = baseLayout('<div>Content</div>', {
      title: 'Test',
      headExtra: '<script src="custom.js"></script>',
    });

    expect(html).toContain('<script src="custom.js"></script>');
  });

  it('should merge theme colors with defaults', () => {
    const html = baseLayout('<div>Content</div>', {
      title: 'Test',
      theme: {
        colors: {
          primary: '#ff0000',
        },
      },
    });

    expect(html).toContain('--color-primary: #ff0000');
    // Should still have other defaults
    expect(html).toContain('--color-secondary');
  });

  it('should include custom fonts in theme', () => {
    const html = baseLayout('<div>Content</div>', {
      title: 'Test',
      theme: {
        fonts: {
          sans: 'Roboto, sans-serif',
        },
      },
    });

    expect(html).toContain('--font-sans: Roboto, sans-serif');
  });

  it('should include customVars in theme', () => {
    const html = baseLayout('<div>Content</div>', {
      title: 'Test',
      theme: {
        customVars: '--custom-spacing: 16px;',
      },
    });

    expect(html).toContain('--custom-spacing: 16px;');
  });

  it('should include customCss outside theme', () => {
    const html = baseLayout('<div>Content</div>', {
      title: 'Test',
      theme: {
        customCss: '.custom-class { color: red; }',
      },
    });

    expect(html).toContain('.custom-class { color: red; }');
  });
});

describe('createLayout', () => {
  it('should create a layout function with default options', () => {
    const customLayout = createLayout({
      theme: {
        colors: {
          primary: '#ff6b6b',
        },
      },
    });

    const html = customLayout('<div>Content</div>', { title: 'Test' });

    expect(html).toContain('--color-primary: #ff6b6b');
  });

  it('should allow overriding default options', () => {
    const customLayout = createLayout({
      bodyClass: 'default-body-class',
    });

    const html = customLayout('<div>Content</div>', {
      title: 'Test',
      bodyClass: 'override-body-class',
    });

    expect(html).toContain('override-body-class');
    expect(html).not.toContain('default-body-class');
  });

  it('should deep merge themes', () => {
    const customLayout = createLayout({
      theme: {
        colors: {
          primary: '#default-primary',
          secondary: '#default-secondary',
        },
      },
    });

    const html = customLayout('<div>Content</div>', {
      title: 'Test',
      theme: {
        colors: {
          primary: '#override-primary',
        },
      },
    });

    expect(html).toContain('--color-primary: #override-primary');
    expect(html).toContain('--color-secondary: #default-secondary');
  });
});

describe('centeredCardLayout', () => {
  it('should wrap content in centered container', () => {
    const html = centeredCardLayout('<div>Card Content</div>', { title: 'Test' });

    expect(html).toContain('flex items-center justify-center');
    expect(html).toContain('max-w-md');
    expect(html).toContain('<div>Card Content</div>');
  });

  it('should apply gradient background', () => {
    const html = centeredCardLayout('<div>Card Content</div>', { title: 'Test' });

    expect(html).toContain('bg-gradient-to-br from-primary to-secondary');
  });
});

describe('wideLayout', () => {
  it('should wrap content in wide container', () => {
    const html = wideLayout('<div>Wide Content</div>', { title: 'Test' });

    expect(html).toContain('max-w-2xl');
    expect(html).toContain('<div>Wide Content</div>');
  });

  it('should include proper padding', () => {
    const html = wideLayout('<div>Wide Content</div>', { title: 'Test' });

    expect(html).toContain('py-8 px-4');
  });
});

describe('extraWideLayout', () => {
  it('should wrap content in extra wide container', () => {
    const html = extraWideLayout('<div>Extra Wide Content</div>', { title: 'Test' });

    expect(html).toContain('max-w-3xl');
    expect(html).toContain('<div>Extra Wide Content</div>');
  });

  it('should include proper padding', () => {
    const html = extraWideLayout('<div>Extra Wide Content</div>', { title: 'Test' });

    expect(html).toContain('py-8 px-4');
  });
});

describe('authLayout', () => {
  it('should be a function that wraps content', () => {
    expect(typeof authLayout).toBe('function');
  });

  it('should generate valid HTML', () => {
    const html = authLayout('<div>Auth Content</div>', { title: 'Login' });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<div>Auth Content</div>');
    expect(html).toContain('Login - FrontMCP');
  });
});
