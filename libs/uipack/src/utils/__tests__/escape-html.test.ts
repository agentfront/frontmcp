/**
 * escapeHtml Utility Tests
 *
 * Tests for HTML escaping functions to prevent XSS.
 */

import { escapeHtml, escapeHtmlAttr, escapeJsString } from '../escape-html';

describe('escapeHtml', () => {
  describe('null and undefined handling', () => {
    it('should return empty string for null', () => {
      expect(escapeHtml(null)).toBe('');
    });

    it('should return empty string for undefined', () => {
      expect(escapeHtml(undefined)).toBe('');
    });
  });

  describe('type coercion', () => {
    it('should convert numbers to string', () => {
      expect(escapeHtml(123)).toBe('123');
      expect(escapeHtml(0)).toBe('0');
      expect(escapeHtml(-42.5)).toBe('-42.5');
    });

    it('should convert boolean to string', () => {
      expect(escapeHtml(true)).toBe('true');
      expect(escapeHtml(false)).toBe('false');
    });

    it('should handle objects by calling toString', () => {
      expect(escapeHtml({})).toBe('[object Object]');
      expect(escapeHtml({ toString: () => 'custom' })).toBe('custom');
    });
  });

  describe('HTML escaping', () => {
    it('should escape ampersand', () => {
      expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
    });

    it('should escape less-than', () => {
      expect(escapeHtml('a < b')).toBe('a &lt; b');
    });

    it('should escape greater-than', () => {
      expect(escapeHtml('a > b')).toBe('a &gt; b');
    });

    it('should escape double quotes', () => {
      expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
    });

    it('should escape single quotes', () => {
      expect(escapeHtml("it's")).toBe('it&#39;s');
    });

    it('should escape all special characters in one string', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    it('should escape unicode line terminators', () => {
      expect(escapeHtml('line\u2028sep\u2029')).toBe('line\\u2028sep\\u2029');
    });

    it('should not modify safe strings', () => {
      expect(escapeHtml('Hello World')).toBe('Hello World');
      expect(escapeHtml('abc123')).toBe('abc123');
    });

    it('should handle empty string', () => {
      expect(escapeHtml('')).toBe('');
    });
  });
});

describe('escapeHtmlAttr', () => {
  it('should escape ampersand', () => {
    expect(escapeHtmlAttr('foo & bar')).toBe('foo &amp; bar');
  });

  it('should escape double quotes', () => {
    expect(escapeHtmlAttr('value="test"')).toBe('value=&quot;test&quot;');
  });

  it('should not escape single quotes (lighter escaping)', () => {
    expect(escapeHtmlAttr("it's")).toBe("it's");
  });

  it('should not escape angle brackets (lighter escaping)', () => {
    expect(escapeHtmlAttr('<tag>')).toBe('<tag>');
  });
});

describe('escapeJsString', () => {
  it('should escape backslash', () => {
    expect(escapeJsString('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  it('should escape single quotes', () => {
    expect(escapeJsString("it's")).toBe("it\\'s");
  });

  it('should escape double quotes', () => {
    expect(escapeJsString('say "hello"')).toBe('say \\"hello\\"');
  });

  it('should escape newlines', () => {
    expect(escapeJsString('line1\nline2')).toBe('line1\\nline2');
  });

  it('should escape carriage returns', () => {
    expect(escapeJsString('line1\rline2')).toBe('line1\\rline2');
  });

  it('should escape tabs', () => {
    expect(escapeJsString('col1\tcol2')).toBe('col1\\tcol2');
  });

  it('should escape unicode line terminators', () => {
    expect(escapeJsString('line\u2028sep\u2029')).toBe('line\\u2028sep\\u2029');
  });
});
