// file: libs/browser/src/ui-resource/ui-resource.spec.ts
/**
 * Tests for UI Resource utilities
 */

import {
  createUIResource,
  createToolResultWithUI,
  wrapInDocument,
  minifyHtml,
  renderToString,
  escapeHtml,
  escapeScript,
  safeHtml,
  rawHtml,
  isUIResourceUri,
  extractResourceId,
  createResourceUri,
} from './ui-resource';

describe('createUIResource', () => {
  it('should create a UI resource with default options', () => {
    const html = '<div>Hello World</div>';
    const resource = createUIResource(html);

    expect(resource.uri).toMatch(/^ui:\/\/render\/.+$/);
    expect(resource.html).toBe(html);
    expect(resource.mimeType).toBe('text/html');
    expect(resource._meta).toEqual({
      resourceUri: resource.uri,
      mimeType: 'text/html',
    });
  });

  it('should create resource with custom MIME type', () => {
    const resource = createUIResource('<div>Test</div>', {
      mimeType: 'text/html;profile=ui',
    });

    expect(resource.mimeType).toBe('text/html;profile=ui');
    expect(resource._meta.mimeType).toBe('text/html;profile=ui');
  });

  it('should wrap content with styles when provided', () => {
    const resource = createUIResource('<div>Test</div>', {
      styles: '.test { color: red; }',
    });

    expect(resource.html).toContain('<style>.test { color: red; }</style>');
    expect(resource.html).toContain('<div>Test</div>');
  });

  it('should wrap content with scripts when provided', () => {
    const resource = createUIResource('<div>Test</div>', {
      scripts: 'console.log("hello");',
    });

    expect(resource.html).toContain('<script>console.log("hello");</script>');
    expect(resource.html).toContain('<div>Test</div>');
  });

  it('should wrap content with both styles and scripts', () => {
    const resource = createUIResource('<div>Test</div>', {
      styles: '.test { color: red; }',
      scripts: 'console.log("hello");',
    });

    expect(resource.html).toContain('<style>');
    expect(resource.html).toContain('<script>');
    expect(resource.html).toContain('<div>Test</div>');
  });

  it('should generate unique URIs', () => {
    const resource1 = createUIResource('<div>Test 1</div>');
    const resource2 = createUIResource('<div>Test 2</div>');

    expect(resource1.uri).not.toBe(resource2.uri);
  });
});

describe('createToolResultWithUI', () => {
  it('should create tool result with UI resource link', () => {
    const resource = createUIResource('<div>Chart</div>');
    const result = createToolResultWithUI({ data: [1, 2, 3] }, resource);

    expect(result.content).toEqual({ data: [1, 2, 3] });
    expect(result._meta).toEqual(resource._meta);
  });

  it('should work with any content type', () => {
    const resource = createUIResource('<div>Test</div>');

    const stringResult = createToolResultWithUI('hello', resource);
    expect(stringResult.content).toBe('hello');

    const arrayResult = createToolResultWithUI([1, 2, 3], resource);
    expect(arrayResult.content).toEqual([1, 2, 3]);

    const nullResult = createToolResultWithUI(null, resource);
    expect(nullResult.content).toBeNull();
  });
});

describe('wrapInDocument', () => {
  it('should wrap content in HTML document structure', () => {
    const html = wrapInDocument('<div>Content</div>');

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<head>');
    expect(html).toContain('<body>');
    expect(html).toContain('<div>Content</div>');
    expect(html).toContain('</html>');
  });

  it('should include custom title', () => {
    const html = wrapInDocument('<div>Content</div>', { title: 'My Page' });

    expect(html).toContain('<title>My Page</title>');
  });

  it('should escape title to prevent XSS', () => {
    const html = wrapInDocument('<div>Content</div>', {
      title: '<script>alert("xss")</script>',
    });

    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should include custom CSS', () => {
    const html = wrapInDocument('<div>Content</div>', {
      css: 'body { margin: 0; }',
    });

    expect(html).toContain('<style>body { margin: 0; }</style>');
  });

  it('should include custom JavaScript', () => {
    const html = wrapInDocument('<div>Content</div>', {
      js: 'console.log("init");',
    });

    expect(html).toContain('<script>console.log("init");</script>');
  });
});

describe('minifyHtml', () => {
  it('should remove whitespace between tags', () => {
    const html = '<div>   </div>   <span>test</span>';
    const minified = minifyHtml(html);

    // Whitespace between tags is removed, whitespace inside empty divs becomes space
    expect(minified).toBe('<div></div><span>test</span>');
  });

  it('should collapse multiple spaces', () => {
    const html = '<div>hello    world</div>';
    const minified = minifyHtml(html);

    expect(minified).toBe('<div>hello world</div>');
  });

  it('should trim leading and trailing whitespace', () => {
    const html = '  <div>test</div>  ';
    const minified = minifyHtml(html);

    expect(minified).toBe('<div>test</div>');
  });
});

describe('renderToString', () => {
  it('should return content as-is with default options', () => {
    const content = '<div>Test</div>';
    const result = renderToString(content);

    expect(result).toBe(content);
  });

  it('should wrap in document when fullDocument is true', () => {
    const result = renderToString('<div>Test</div>', { fullDocument: true });

    expect(result).toContain('<!DOCTYPE html>');
    expect(result).toContain('<div>Test</div>');
  });

  it('should minify when minify is true', () => {
    const result = renderToString('<div>   test   </div>', { minify: true });

    expect(result).toBe('<div> test </div>');
  });

  it('should apply both fullDocument and minify', () => {
    const result = renderToString('<div>Test</div>', {
      fullDocument: true,
      minify: true,
    });

    expect(result).toContain('<!DOCTYPE html>');
    expect(result).not.toMatch(/>\s+</);
  });
});

describe('escapeHtml', () => {
  it('should escape HTML special characters', () => {
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#x27;');
  });

  it('should escape all special characters in a string', () => {
    const input = '<script>alert("xss")</script>';
    const escaped = escapeHtml(input);

    expect(escaped).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('should not modify safe strings', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World');
    expect(escapeHtml('123')).toBe('123');
  });
});

describe('escapeScript', () => {
  it('should escape closing script tags', () => {
    const input = '</script>';
    const escaped = escapeScript(input);

    expect(escaped).toBe('<\\/script>');
  });

  it('should escape HTML comments', () => {
    const input = '<!-- comment -->';
    const escaped = escapeScript(input);

    expect(escaped).toBe('<\\!-- comment -->');
  });

  it('should handle case-insensitive script tags', () => {
    // The regex replaces but lowercases - this is acceptable for security
    expect(escapeScript('</SCRIPT>')).toBe('<\\/script>');
    expect(escapeScript('</Script>')).toBe('<\\/script>');
  });
});

describe('safeHtml', () => {
  it('should escape interpolated values', () => {
    const userInput = '<script>alert("xss")</script>';
    const html = safeHtml`<div>${userInput}</div>`;

    expect(html).toBe('<div>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</div>');
  });

  it('should handle multiple interpolations', () => {
    const name = '<b>John</b>';
    const role = '<admin>';
    const html = safeHtml`<span>${name}</span> - <span>${role}</span>`;

    expect(html).toBe('<span>&lt;b&gt;John&lt;/b&gt;</span> - <span>&lt;admin&gt;</span>');
  });

  it('should handle undefined and null values', () => {
    const html = safeHtml`<div>${undefined}${null}</div>`;

    expect(html).toBe('<div></div>');
  });

  it('should convert numbers to strings', () => {
    const count = 42;
    const html = safeHtml`<span>Count: ${count}</span>`;

    expect(html).toBe('<span>Count: 42</span>');
  });
});

describe('rawHtml', () => {
  it('should not escape interpolated values', () => {
    const trusted = '<strong>Bold</strong>';
    const html = rawHtml`<div>${trusted}</div>`;

    expect(html).toBe('<div><strong>Bold</strong></div>');
  });

  it('should handle undefined and null values', () => {
    const html = rawHtml`<div>${undefined}${null}</div>`;

    expect(html).toBe('<div></div>');
  });
});

describe('isUIResourceUri', () => {
  it('should return true for valid UI resource URIs', () => {
    expect(isUIResourceUri('ui://render/abc123')).toBe(true);
    expect(isUIResourceUri('ui://render/some-id-here')).toBe(true);
  });

  it('should return false for invalid URIs', () => {
    expect(isUIResourceUri('file://path/to/file')).toBe(false);
    expect(isUIResourceUri('https://example.com')).toBe(false);
    expect(isUIResourceUri('ui://other/path')).toBe(false);
    expect(isUIResourceUri('')).toBe(false);
  });
});

describe('extractResourceId', () => {
  it('should extract ID from valid UI resource URI', () => {
    expect(extractResourceId('ui://render/abc123')).toBe('abc123');
    expect(extractResourceId('ui://render/my-id')).toBe('my-id');
  });

  it('should return null for invalid URIs', () => {
    expect(extractResourceId('file://path/to/file')).toBeNull();
    expect(extractResourceId('https://example.com')).toBeNull();
  });
});

describe('createResourceUri', () => {
  it('should create a valid UI resource URI', () => {
    expect(createResourceUri('abc123')).toBe('ui://render/abc123');
    expect(createResourceUri('my-custom-id')).toBe('ui://render/my-custom-id');
  });
});
