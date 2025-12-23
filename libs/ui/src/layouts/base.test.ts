import { baseLayout, createLayoutBuilder, escapeHtml } from './base';
import { OPENAI_PLATFORM, CLAUDE_PLATFORM } from '@frontmcp/uipack/theme';

describe('Base Layout Module', () => {
  describe('escapeHtml', () => {
    it('should escape ampersand', () => {
      expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
    });

    it('should escape less than', () => {
      expect(escapeHtml('a < b')).toBe('a &lt; b');
    });

    it('should escape greater than', () => {
      expect(escapeHtml('a > b')).toBe('a &gt; b');
    });

    it('should escape double quotes', () => {
      expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
    });

    it('should escape single quotes', () => {
      expect(escapeHtml("it's")).toBe('it&#39;s');
    });

    it('should escape multiple characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    it('should handle empty string', () => {
      expect(escapeHtml('')).toBe('');
    });
  });

  describe('baseLayout', () => {
    it('should generate valid HTML document', () => {
      const html = baseLayout('<div>Content</div>', {
        title: 'Test Page',
      });
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('<head>');
      expect(html).toContain('<body');
      expect(html).toContain('</html>');
    });

    it('should include page title', () => {
      const html = baseLayout('<div>Content</div>', {
        title: 'My Test Page',
      });
      expect(html).toContain('<title>My Test Page');
    });

    it('should include title suffix', () => {
      const html = baseLayout('<div>Content</div>', {
        title: 'Test',
        titleSuffix: 'MySite',
      });
      expect(html).toContain('<title>Test - MySite</title>');
    });

    it('should escape title to prevent XSS', () => {
      const html = baseLayout('<div>Content</div>', {
        title: '<script>alert("xss")</script>',
      });
      expect(html).not.toContain('<script>alert');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should include meta description when provided', () => {
      const html = baseLayout('<div>Content</div>', {
        title: 'Test',
        description: 'This is a test page',
      });
      expect(html).toContain('name="description"');
      expect(html).toContain('This is a test page');
    });

    it('should include Open Graph meta tags', () => {
      const html = baseLayout('<div>Content</div>', {
        title: 'Test',
        og: {
          title: 'OG Title',
          description: 'OG Description',
          image: 'https://example.com/image.png',
        },
      });
      expect(html).toContain('og:title');
      expect(html).toContain('og:description');
      expect(html).toContain('og:image');
    });

    it('should include favicon when provided', () => {
      const html = baseLayout('<div>Content</div>', {
        title: 'Test',
        favicon: '/favicon.ico',
      });
      expect(html).toContain('rel="icon"');
      expect(html).toContain('/favicon.ico');
    });

    it('should include Tailwind CSS CDN', () => {
      const html = baseLayout('<div>Content</div>', {
        title: 'Test',
        platform: OPENAI_PLATFORM,
      });
      expect(html).toContain('tailwindcss');
    });

    it('should include theme CSS variables', () => {
      const html = baseLayout('<div>Content</div>', {
        title: 'Test',
        platform: OPENAI_PLATFORM,
      });
      expect(html).toContain('@theme');
      expect(html).toContain('--color-primary');
    });

    it('should apply custom theme colors', () => {
      const html = baseLayout('<div>Content</div>', {
        title: 'Test',
        theme: {
          colors: {
            semantic: {
              primary: '#ff0000',
            },
          },
        },
      });
      expect(html).toContain('#ff0000');
    });

    it('should use gradient background for gradient style', () => {
      const html = baseLayout('<div>Content</div>', {
        title: 'Test',
        background: 'gradient',
      });
      expect(html).toContain('bg-gradient-to-br');
    });

    it('should use solid background for solid style', () => {
      const html = baseLayout('<div>Content</div>', {
        title: 'Test',
        background: 'solid',
      });
      expect(html).toContain('bg-background');
    });

    it('should center align content when specified', () => {
      const html = baseLayout('<div>Content</div>', {
        title: 'Test',
        alignment: 'center',
      });
      expect(html).toContain('items-center');
      expect(html).toContain('justify-center');
    });

    it('should set max-width based on size', () => {
      const sizes = [
        { size: 'xs' as const, class: 'max-w-sm' },
        { size: 'sm' as const, class: 'max-w-md' },
        { size: 'md' as const, class: 'max-w-lg' },
        { size: 'lg' as const, class: 'max-w-xl' },
        { size: 'full' as const, class: 'max-w-full' },
      ];

      for (const { size, class: expected } of sizes) {
        const html = baseLayout('<div>Content</div>', {
          title: 'Test',
          size,
        });
        expect(html).toContain(expected);
      }
    });

    it('should include content in body', () => {
      const html = baseLayout('<div class="my-content">Hello World</div>', {
        title: 'Test',
      });
      expect(html).toContain('<div class="my-content">Hello World</div>');
    });

    it('should include HTMX when platform supports it', () => {
      const html = baseLayout('<div>Content</div>', {
        title: 'Test',
        platform: OPENAI_PLATFORM,
        includeHtmx: true,
      });
      expect(html).toContain('htmx');
    });

    it('should include head extra content', () => {
      const html = baseLayout('<div>Content</div>', {
        title: 'Test',
        headExtra: '<link rel="canonical" href="https://example.com">',
      });
      expect(html).toContain('rel="canonical"');
    });

    it('should add body attributes when provided', () => {
      const html = baseLayout('<div>Content</div>', {
        title: 'Test',
        bodyAttrs: {
          'data-page': 'test',
        },
      });
      expect(html).toContain('data-page="test"');
    });

    it('should add body class when provided', () => {
      const html = baseLayout('<div>Content</div>', {
        title: 'Test',
        bodyClass: 'custom-page',
      });
      expect(html).toContain('custom-page');
    });
  });

  describe('createLayoutBuilder', () => {
    it('should create a builder with preset options', () => {
      const authLayout = createLayoutBuilder({
        size: 'sm',
        alignment: 'center',
        background: 'gradient',
      });

      const html = authLayout('<div>Login Form</div>', {
        title: 'Login',
      });

      expect(html).toContain('max-w-md');
      expect(html).toContain('items-center');
      expect(html).toContain('bg-gradient-to-br');
    });

    it('should allow option overrides', () => {
      const authLayout = createLayoutBuilder({
        size: 'sm',
      });

      const html = authLayout('<div>Content</div>', {
        title: 'Test',
        size: 'lg', // Override
      });

      expect(html).toContain('max-w-xl');
    });

    it('should merge theme options', () => {
      const customLayout = createLayoutBuilder({
        theme: {
          colors: {
            semantic: {
              primary: '#0000ff',
            },
          },
        },
      });

      const html = customLayout('<div>Content</div>', {
        title: 'Test',
        theme: {
          colors: {
            semantic: {
              secondary: '#00ff00',
            },
          },
        },
      });

      expect(html).toContain('#0000ff');
      expect(html).toContain('#00ff00');
    });
  });
});
