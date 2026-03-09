/**
 * Template Helpers Tests
 *
 * Tests for the SDK's template helper functions.
 * These tests ensure helpers handle edge cases like null/undefined values.
 */

import { escapeHtml, formatDate, formatCurrency, uniqueId, jsonEmbed, resetIdCounter } from '../template-helpers';

describe('escapeHtml', () => {
  describe('null and undefined handling', () => {
    it('should return empty string for null', () => {
      expect(escapeHtml(null)).toBe('');
    });

    it('should return empty string for undefined', () => {
      expect(escapeHtml(undefined)).toBe('');
    });

    it('should handle undefined from destructured object properties', () => {
      // This is the exact bug scenario: destructuring from empty object
      const output = {} as { label?: string; value?: string };
      const { label, value } = output;

      // Before fix: TypeError: Cannot read properties of undefined (reading 'replace')
      // After fix: returns empty string
      expect(escapeHtml(label)).toBe('');
      expect(escapeHtml(value)).toBe('');
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
      // UI library uses &#39; (shorter form, both are valid HTML entities)
      expect(escapeHtml("it's")).toBe('it&#39;s');
    });

    it('should escape all special characters in XSS attack', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
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

describe('formatDate', () => {
  it('should format Date object', () => {
    const date = new Date('2024-01-15T12:00:00Z');
    const result = formatDate(date);
    // Result varies by locale, just check it's a non-empty string
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should format ISO string', () => {
    const result = formatDate('2024-01-15T12:00:00Z');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should return ISO format when specified', () => {
    const date = new Date('2024-01-15T12:00:00Z');
    const result = formatDate(date, 'iso');
    expect(result).toBe('2024-01-15T12:00:00.000Z');
  });

  it('should handle invalid date string', () => {
    const result = formatDate('invalid-date');
    expect(result).toBe('invalid-date');
  });
});

describe('formatCurrency', () => {
  it('should format USD by default', () => {
    expect(formatCurrency(1234.56)).toBe('$1,234.56');
  });

  it('should format other currencies', () => {
    expect(formatCurrency(1234.56, 'EUR')).toContain('1,234.56');
  });

  it('should handle zero', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });

  it('should handle negative numbers', () => {
    expect(formatCurrency(-100)).toBe('-$100.00');
  });
});

describe('uniqueId', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it('should generate unique IDs', () => {
    const id1 = uniqueId();
    const id2 = uniqueId();
    expect(id1).not.toBe(id2);
  });

  it('should use default prefix', () => {
    const id = uniqueId();
    expect(id).toMatch(/^mcp-/);
  });

  it('should use custom prefix', () => {
    const id = uniqueId('custom');
    expect(id).toMatch(/^custom-/);
  });
});

describe('jsonEmbed', () => {
  it('should stringify JSON', () => {
    const result = jsonEmbed({ key: 'value' });
    expect(result).toContain('key');
    expect(result).toContain('value');
  });

  it('should escape script-breaking characters', () => {
    const result = jsonEmbed({ html: '<script>alert("xss")</script>' });
    expect(result).not.toContain('<script>');
    expect(result).toContain('\\u003c');
    expect(result).toContain('\\u003e');
  });

  it('should escape ampersand', () => {
    const result = jsonEmbed({ text: 'foo & bar' });
    expect(result).toContain('\\u0026');
  });

  it('should handle null', () => {
    expect(jsonEmbed(null)).toBe('null');
  });

  it('should handle arrays', () => {
    const result = jsonEmbed([1, 2, 3]);
    expect(result).toBe('[1,2,3]');
  });
});
