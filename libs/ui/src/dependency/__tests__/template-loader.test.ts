/**
 * Template Loader Tests
 *
 * Tests for template source detection, URL fetching, and file loading.
 */

import {
  detectTemplateSource,
  isFileBasedTemplate,
  validateTemplateUrl,
  detectFormatFromUrl,
  resolveFilePath,
  getUrlCache,
  clearUrlCache,
  needsRefetch,
  invalidateUrlCache,
} from '../template-loader';
import type { ResolvedTemplate, TemplateMode } from '../types';

describe('detectTemplateSource', () => {
  describe('inline templates', () => {
    it('should detect HTML content as inline', () => {
      const result = detectTemplateSource('<div>Hello</div>');
      expect(result).toEqual({ type: 'inline', content: '<div>Hello</div>' });
    });

    it('should detect Handlebars template as inline', () => {
      const result = detectTemplateSource('<div>{{output.name}}</div>');
      expect(result).toEqual({ type: 'inline', content: '<div>{{output.name}}</div>' });
    });

    it('should detect empty string as inline', () => {
      const result = detectTemplateSource('');
      expect(result).toEqual({ type: 'inline', content: '' });
    });

    it('should detect plain text as inline', () => {
      const result = detectTemplateSource('Hello World');
      expect(result).toEqual({ type: 'inline', content: 'Hello World' });
    });
  });

  describe('file path templates', () => {
    it('should detect relative path starting with ./', () => {
      const result = detectTemplateSource('./widgets/chart.tsx');
      expect(result).toEqual({ type: 'file', path: './widgets/chart.tsx' });
    });

    it('should detect relative path starting with ../', () => {
      const result = detectTemplateSource('../components/button.html');
      expect(result).toEqual({ type: 'file', path: '../components/button.html' });
    });

    it('should detect absolute path starting with /', () => {
      const result = detectTemplateSource('/app/templates/widget.mdx');
      expect(result).toEqual({ type: 'file', path: '/app/templates/widget.mdx' });
    });
  });

  describe('URL templates', () => {
    it('should detect HTTPS URL', () => {
      const result = detectTemplateSource('https://cdn.example.com/widget.html');
      expect(result).toEqual({ type: 'url', url: 'https://cdn.example.com/widget.html' });
    });

    it('should detect HTTP URL', () => {
      const result = detectTemplateSource('http://cdn.example.com/widget.html');
      expect(result).toEqual({ type: 'url', url: 'http://cdn.example.com/widget.html' });
    });

    it('should detect CDN URL with path', () => {
      const result = detectTemplateSource('https://cdnjs.cloudflare.com/ajax/libs/my-lib/1.0.0/widget.min.js');
      expect(result).toEqual({
        type: 'url',
        url: 'https://cdnjs.cloudflare.com/ajax/libs/my-lib/1.0.0/widget.min.js',
      });
    });
  });
});

describe('isFileBasedTemplate', () => {
  it('should return true for file-path mode', () => {
    expect(isFileBasedTemplate('file-path')).toBe(true);
  });

  it('should return true for url mode', () => {
    expect(isFileBasedTemplate('url')).toBe(true);
  });

  it('should return false for inline-string mode', () => {
    expect(isFileBasedTemplate('inline-string')).toBe(false);
  });

  it('should return false for inline-function mode', () => {
    expect(isFileBasedTemplate('inline-function')).toBe(false);
  });
});

describe('validateTemplateUrl', () => {
  it('should accept valid HTTPS URL', () => {
    expect(() => validateTemplateUrl('https://cdn.example.com/widget.html')).not.toThrow();
  });

  it('should throw for HTTP URL', () => {
    expect(() => validateTemplateUrl('http://cdn.example.com/widget.html')).toThrow('Template URLs must use HTTPS');
  });

  it('should throw for invalid URL', () => {
    expect(() => validateTemplateUrl('not-a-url')).toThrow();
  });
});

describe('detectFormatFromUrl', () => {
  it('should detect .html format', () => {
    expect(detectFormatFromUrl('https://cdn.example.com/widget.html')).toBe('html');
  });

  it('should detect .tsx format', () => {
    expect(detectFormatFromUrl('https://cdn.example.com/component.tsx')).toBe('react');
  });

  it('should detect .jsx format', () => {
    expect(detectFormatFromUrl('https://cdn.example.com/component.jsx')).toBe('react');
  });

  it('should detect .mdx format', () => {
    expect(detectFormatFromUrl('https://cdn.example.com/docs.mdx')).toBe('mdx');
  });

  it('should detect .md format', () => {
    expect(detectFormatFromUrl('https://cdn.example.com/readme.md')).toBe('markdown');
  });

  it('should default to html for unknown extension', () => {
    expect(detectFormatFromUrl('https://cdn.example.com/widget.js')).toBe('html');
  });

  it('should handle URLs with query parameters', () => {
    expect(detectFormatFromUrl('https://cdn.example.com/widget.html?v=1.0')).toBe('html');
  });
});

describe('resolveFilePath', () => {
  it('should return absolute path as-is', () => {
    expect(resolveFilePath('/app/templates/widget.html')).toBe('/app/templates/widget.html');
  });

  it('should resolve relative path with basePath', () => {
    const result = resolveFilePath('./widget.html', '/app/templates');
    expect(result).toBe('/app/templates/widget.html');
  });

  it('should resolve parent relative path', () => {
    const result = resolveFilePath('../shared/widget.html', '/app/templates');
    expect(result).toBe('/app/shared/widget.html');
  });

  it('should use process.cwd() as default basePath', () => {
    const result = resolveFilePath('./widget.html');
    expect(result).toContain('widget.html');
  });
});

describe('URL cache management', () => {
  beforeEach(() => {
    clearUrlCache();
  });

  it('should start with empty cache', () => {
    expect(getUrlCache().size).toBe(0);
  });

  it('should clear cache', () => {
    const cache = getUrlCache();
    cache.set('https://example.com/widget.html', {
      content: '<div>test</div>',
      fetchedAt: new Date().toISOString(),
    });
    expect(cache.size).toBe(1);

    clearUrlCache();
    expect(cache.size).toBe(0);
  });

  it('should invalidate specific URL', () => {
    const cache = getUrlCache();
    cache.set('https://example.com/a.html', { content: 'a', fetchedAt: new Date().toISOString() });
    cache.set('https://example.com/b.html', { content: 'b', fetchedAt: new Date().toISOString() });
    expect(cache.size).toBe(2);

    const removed = invalidateUrlCache('https://example.com/a.html');
    expect(removed).toBe(true);
    expect(cache.size).toBe(1);
    expect(cache.has('https://example.com/b.html')).toBe(true);
  });

  it('should return false when invalidating non-existent URL', () => {
    const removed = invalidateUrlCache('https://example.com/nonexistent.html');
    expect(removed).toBe(false);
  });
});

describe('needsRefetch', () => {
  beforeEach(() => {
    clearUrlCache();
  });

  it('should return false for non-URL sources', () => {
    const resolved: ResolvedTemplate = {
      source: { type: 'file', path: './widget.html' },
      format: 'html',
      content: '<div>test</div>',
      hash: 'abc123',
    };
    expect(needsRefetch(resolved)).toBe(false);
  });

  it('should return false for inline sources', () => {
    const resolved: ResolvedTemplate = {
      source: { type: 'inline', content: '<div>test</div>' },
      format: 'html',
      content: '<div>test</div>',
      hash: 'abc123',
    };
    expect(needsRefetch(resolved)).toBe(false);
  });

  it('should return true when URL not in cache', () => {
    const resolved: ResolvedTemplate = {
      source: { type: 'url', url: 'https://cdn.example.com/widget.html' },
      format: 'html',
      content: '<div>test</div>',
      hash: 'abc123',
    };
    expect(needsRefetch(resolved)).toBe(true);
  });

  it('should return false when URL in cache with ETag', () => {
    const cache = getUrlCache();
    cache.set('https://cdn.example.com/widget.html', {
      content: '<div>test</div>',
      etag: '"abc123"',
      fetchedAt: new Date().toISOString(),
    });

    const resolved: ResolvedTemplate = {
      source: { type: 'url', url: 'https://cdn.example.com/widget.html' },
      format: 'html',
      content: '<div>test</div>',
      hash: 'abc123',
    };
    expect(needsRefetch(resolved)).toBe(false);
  });

  it('should return false when URL in cache without ETag but within TTL', () => {
    const cache = getUrlCache();
    cache.set('https://cdn.example.com/widget.html', {
      content: '<div>test</div>',
      fetchedAt: new Date().toISOString(), // Fresh entry
    });

    const resolved: ResolvedTemplate = {
      source: { type: 'url', url: 'https://cdn.example.com/widget.html' },
      format: 'html',
      content: '<div>test</div>',
      hash: 'abc123',
    };
    // Fresh entries without ETag don't need refetch until TTL expires
    expect(needsRefetch(resolved)).toBe(false);
  });

  it('should return true when URL in cache without ETag and TTL expired', () => {
    const cache = getUrlCache();
    // Create a timestamp 6 minutes ago (beyond the 5-min TTL)
    const expiredTime = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    cache.set('https://cdn.example.com/expired-widget.html', {
      content: '<div>expired</div>',
      fetchedAt: expiredTime,
    });

    const resolved: ResolvedTemplate = {
      source: { type: 'url', url: 'https://cdn.example.com/expired-widget.html' },
      format: 'html',
      content: '<div>expired</div>',
      hash: 'def456',
    };
    // Expired entries without ETag need refetch
    expect(needsRefetch(resolved)).toBe(true);
  });
});
