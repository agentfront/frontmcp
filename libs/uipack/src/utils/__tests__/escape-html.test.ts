/**
 * escapeHtml Utility Tests
 *
 * Tests for HTML escaping functions to prevent XSS.
 */

import { escapeHtml, escapeHtmlAttr, escapeJsString, escapeScriptClose, safeJsonForScript } from '../escape-html';

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

describe('escapeScriptClose', () => {
  it('should escape </script> closing tags', () => {
    const json = JSON.stringify({ html: '</script>' });
    expect(escapeScriptClose(json)).toBe('{"html":"<\\/script>"}');
  });

  it('should escape multiple closing tags', () => {
    const json = JSON.stringify({ html: '</script><script>alert(1)</script>' });
    expect(escapeScriptClose(json)).toBe('{"html":"<\\/script><script>alert(1)<\\/script>"}');
  });

  it('should escape any </ sequence', () => {
    const json = JSON.stringify({ html: '</div></span>' });
    expect(escapeScriptClose(json)).toBe('{"html":"<\\/div><\\/span>"}');
  });

  it('should not modify strings without </', () => {
    const json = JSON.stringify({ name: 'test' });
    expect(escapeScriptClose(json)).toBe(json);
  });

  it('should handle empty string', () => {
    expect(escapeScriptClose('')).toBe('');
  });
});

describe('safeJsonForScript', () => {
  it('should serialize and escape simple objects', () => {
    const result = safeJsonForScript({ name: 'test' });
    expect(result).toBe('{"name":"test"}');
  });

  it('should escape </script> in values', () => {
    const result = safeJsonForScript({ html: '</script><script>alert("xss")</script>' });
    expect(result).toContain('<\\/script>');
    expect(result).not.toContain('</script>');
  });

  it('should handle nested objects with script tags', () => {
    const result = safeJsonForScript({
      outer: {
        inner: '</script>',
      },
    });
    expect(result).toBe('{"outer":{"inner":"<\\/script>"}}');
  });

  it('should handle arrays with script tags', () => {
    const result = safeJsonForScript(['</script>', '<script>']);
    expect(result).toBe('["<\\/script>","<script>"]');
  });

  it('should handle null', () => {
    expect(safeJsonForScript(null)).toBe('null');
  });

  it('should handle undefined by returning null', () => {
    expect(safeJsonForScript(undefined)).toBe('null');
  });

  it('should handle primitive values', () => {
    expect(safeJsonForScript(123)).toBe('123');
    expect(safeJsonForScript('hello')).toBe('"hello"');
    expect(safeJsonForScript(true)).toBe('true');
  });

  it('should handle circular references gracefully', () => {
    const circular: Record<string, unknown> = { name: 'test' };
    circular.self = circular;
    const result = safeJsonForScript(circular);
    expect(result).toBe('{"error":"Value could not be serialized"}');
  });

  it('should handle BigInt values by converting to string', () => {
    const result = safeJsonForScript({ big: BigInt(9007199254740991) });
    expect(result).toBe('{"big":"9007199254740991"}');
  });

  it('should handle functions by omitting them', () => {
    const result = safeJsonForScript({
      name: 'test',
      fn: () => {},
    });
    expect(result).toBe('{"name":"test"}');
  });

  it('should handle symbols by omitting them', () => {
    const result = safeJsonForScript({
      name: 'test',
      sym: Symbol('test'),
    });
    expect(result).toBe('{"name":"test"}');
  });

  it('should return null for standalone function', () => {
    const result = safeJsonForScript(() => {});
    expect(result).toBe('null');
  });

  it('should return null for standalone symbol', () => {
    const result = safeJsonForScript(Symbol('test'));
    expect(result).toBe('null');
  });

  it('should be safe for embedding in script tags', () => {
    const malicious = { data: '</script><script>alert("xss")</script>' };
    const result = safeJsonForScript(malicious);

    // The result should not contain unescaped </script>
    expect(result).not.toMatch(/<\/script>/i);

    // It should be valid JSON when the escape is reversed
    const unescaped = result.replace(/<\\\//g, '</');
    expect(() => JSON.parse(unescaped)).not.toThrow();
    expect(JSON.parse(unescaped)).toEqual(malicious);
  });
});
