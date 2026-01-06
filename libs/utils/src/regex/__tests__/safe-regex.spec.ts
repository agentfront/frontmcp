import {
  analyzePattern,
  isPatternSafe,
  createSafeRegExp,
  safeTest,
  safeMatch,
  safeReplace,
  safeExec,
  isInputLengthSafe,
  DEFAULT_MAX_INPUT_LENGTH,
} from '../safe-regex';
import {
  trimLeading,
  trimTrailing,
  trimBoth,
  trimChars,
  extractBracedParams,
  expandTemplate,
  hasTemplatePlaceholders,
  collapseChar,
  collapseWhitespace,
} from '../patterns';

describe('safe-regex', () => {
  describe('analyzePattern', () => {
    it('should identify safe patterns', () => {
      const result = analyzePattern('[a-z]+');
      expect(result.safe).toBe(true);
      expect(result.score).toBeLessThan(50);
    });

    it('should identify vulnerable nested quantifier patterns', () => {
      const result = analyzePattern('(a+)+');
      expect(result.safe).toBe(false);
      expect(result.score).toBeGreaterThanOrEqual(50);
    });

    it('should work with RegExp objects', () => {
      const result = analyzePattern(/[a-z]+/);
      expect(result.safe).toBe(true);
    });

    it('should handle invalid patterns gracefully', () => {
      const result = analyzePattern('(');
      expect(result.safe).toBe(false);
      expect(result.score).toBe(100);
      expect(result.vulnerabilityType).toBe('invalid_syntax');
    });
  });

  describe('isPatternSafe', () => {
    it('should return true for safe patterns', () => {
      expect(isPatternSafe('[a-z]+')).toBe(true);
      expect(isPatternSafe('^foo$')).toBe(true);
      expect(isPatternSafe('\\d{3}')).toBe(true);
    });

    it('should return false for vulnerable patterns', () => {
      expect(isPatternSafe('(a+)+')).toBe(false);
      expect(isPatternSafe('(.*a)+')).toBe(false);
    });
  });

  describe('createSafeRegExp', () => {
    it('should create RegExp for safe patterns', () => {
      const regex = createSafeRegExp('[a-z]+', 'g');
      expect(regex).toBeInstanceOf(RegExp);
      expect(regex?.flags).toBe('g');
    });

    it('should return null for vulnerable patterns', () => {
      const regex = createSafeRegExp('(a+)+');
      expect(regex).toBeNull();
    });

    it('should return null for invalid patterns', () => {
      const regex = createSafeRegExp('(');
      expect(regex).toBeNull();
    });

    it('should throw when throwOnVulnerable is true', () => {
      expect(() => {
        createSafeRegExp('(a+)+', undefined, { throwOnVulnerable: true });
      }).toThrow();
    });
  });

  describe('safeTest', () => {
    it('should return true for matching input', () => {
      expect(safeTest(/foo/, 'foobar')).toBe(true);
    });

    it('should return false for non-matching input', () => {
      expect(safeTest(/foo/, 'bar')).toBe(false);
    });

    it('should return null for input exceeding max length', () => {
      const longInput = 'a'.repeat(DEFAULT_MAX_INPUT_LENGTH + 1);
      expect(safeTest(/a/, longInput)).toBeNull();
    });

    it('should respect custom maxInputLength', () => {
      const input = 'a'.repeat(100);
      expect(safeTest(/a/, input, { maxInputLength: 50 })).toBeNull();
      expect(safeTest(/a/, input, { maxInputLength: 200 })).toBe(true);
    });
  });

  describe('safeMatch', () => {
    it('should return matches for valid input', () => {
      const result = safeMatch(/(\d+)/, 'foo123bar');
      expect(result).not.toBeNull();
      expect(result?.[1]).toBe('123');
    });

    it('should return null for input exceeding max length', () => {
      const longInput = 'a'.repeat(DEFAULT_MAX_INPUT_LENGTH + 1);
      expect(safeMatch(/a/, longInput)).toBeNull();
    });
  });

  describe('safeReplace', () => {
    it('should replace for valid input', () => {
      const result = safeReplace('hello world', /world/, 'foo');
      expect(result).toBe('hello foo');
    });

    it('should return original input when exceeding max length', () => {
      const longInput = 'a'.repeat(DEFAULT_MAX_INPUT_LENGTH + 1);
      const result = safeReplace(longInput, /a/, 'b');
      expect(result).toBe(longInput);
    });
  });

  describe('safeExec', () => {
    it('should execute for valid input', () => {
      const result = safeExec(/(\d+)/, 'foo123bar');
      expect(result).not.toBeNull();
      expect(result?.[1]).toBe('123');
    });

    it('should return null for input exceeding max length', () => {
      const longInput = 'a'.repeat(DEFAULT_MAX_INPUT_LENGTH + 1);
      expect(safeExec(/a/, longInput)).toBeNull();
    });
  });

  describe('isInputLengthSafe', () => {
    it('should return true for short input', () => {
      expect(isInputLengthSafe('hello')).toBe(true);
    });

    it('should return false for long input', () => {
      const longInput = 'a'.repeat(DEFAULT_MAX_INPUT_LENGTH + 1);
      expect(isInputLengthSafe(longInput)).toBe(false);
    });

    it('should respect custom max length', () => {
      expect(isInputLengthSafe('hello', 3)).toBe(false);
      expect(isInputLengthSafe('hi', 3)).toBe(true);
    });
  });
});

describe('patterns', () => {
  describe('trimLeading', () => {
    it('should remove leading characters', () => {
      expect(trimLeading('///path', '/')).toBe('path');
      expect(trimLeading('---name', '-')).toBe('name');
    });

    it('should handle no leading characters', () => {
      expect(trimLeading('path', '/')).toBe('path');
    });

    it('should handle empty string', () => {
      expect(trimLeading('', '/')).toBe('');
    });

    it('should handle all-char string', () => {
      expect(trimLeading('///', '/')).toBe('');
    });

    it('should handle null/undefined', () => {
      expect(trimLeading(null as unknown as string, '/')).toBe('');
      expect(trimLeading(undefined as unknown as string, '/')).toBe('');
    });
  });

  describe('trimTrailing', () => {
    it('should remove trailing characters', () => {
      expect(trimTrailing('path///', '/')).toBe('path');
      expect(trimTrailing('name---', '-')).toBe('name');
    });

    it('should handle no trailing characters', () => {
      expect(trimTrailing('path', '/')).toBe('path');
    });

    it('should handle empty string', () => {
      expect(trimTrailing('', '/')).toBe('');
    });

    it('should handle all-char string', () => {
      expect(trimTrailing('///', '/')).toBe('');
    });
  });

  describe('trimBoth', () => {
    it('should remove both leading and trailing characters', () => {
      expect(trimBoth('///path///', '/')).toBe('path');
      expect(trimBoth('---name---', '-')).toBe('name');
    });

    it('should handle only leading characters', () => {
      expect(trimBoth('///path', '/')).toBe('path');
    });

    it('should handle only trailing characters', () => {
      expect(trimBoth('path///', '/')).toBe('path');
    });

    it('should handle no characters to trim', () => {
      expect(trimBoth('path', '/')).toBe('path');
    });
  });

  describe('trimChars', () => {
    it('should remove multiple character types', () => {
      expect(trimChars('  -name-  ', new Set([' ', '-']))).toBe('name');
    });

    it('should handle empty input', () => {
      expect(trimChars('', new Set([' ']))).toBe('');
    });

    it('should handle no chars to trim', () => {
      expect(trimChars('hello', new Set([' ']))).toBe('hello');
    });
  });

  describe('extractBracedParams', () => {
    it('should extract parameters', () => {
      expect(extractBracedParams('/users/{userId}/posts/{postId}')).toEqual(['userId', 'postId']);
    });

    it('should handle single parameter', () => {
      expect(extractBracedParams('Hello {name}!')).toEqual(['name']);
    });

    it('should handle no parameters', () => {
      expect(extractBracedParams('no params here')).toEqual([]);
    });

    it('should handle empty string', () => {
      expect(extractBracedParams('')).toEqual([]);
    });

    it('should handle unclosed braces', () => {
      expect(extractBracedParams('{unclosed')).toEqual([]);
    });

    it('should skip nested braces', () => {
      // Nested braces are invalid - the entire pattern is skipped
      expect(extractBracedParams('{outer{inner}}')).toEqual([]);
      // But separate valid params after invalid ones should still be found
      expect(extractBracedParams('{outer{inner}} {valid}')).toEqual(['valid']);
    });

    it('should return empty for input exceeding max length', () => {
      const longTemplate = '{' + 'a'.repeat(60000) + '}';
      expect(extractBracedParams(longTemplate)).toEqual([]);
    });
  });

  describe('expandTemplate', () => {
    it('should expand placeholders', () => {
      expect(expandTemplate('/users/{userId}', { userId: '123' })).toBe('/users/123');
    });

    it('should handle multiple placeholders', () => {
      expect(expandTemplate('{greeting} {name}!', { greeting: 'Hello', name: 'World' })).toBe('Hello World!');
    });

    it('should keep missing placeholders', () => {
      expect(expandTemplate('Hello {name}!', {})).toBe('Hello {name}!');
    });

    it('should handle empty template', () => {
      expect(expandTemplate('', { foo: 'bar' })).toBe('');
    });
  });

  describe('hasTemplatePlaceholders', () => {
    it('should detect placeholders', () => {
      expect(hasTemplatePlaceholders('/users/{id}')).toBe(true);
    });

    it('should return false for no placeholders', () => {
      expect(hasTemplatePlaceholders('/users/123')).toBe(false);
    });

    it('should return false for incomplete braces', () => {
      expect(hasTemplatePlaceholders('/users/{id')).toBe(false);
      expect(hasTemplatePlaceholders('/users/id}')).toBe(false);
    });

    it('should return false for empty braces', () => {
      expect(hasTemplatePlaceholders('/users/{}')).toBe(false);
    });
  });

  describe('collapseChar', () => {
    it('should collapse consecutive characters', () => {
      expect(collapseChar('foo///bar', '/')).toBe('foo/bar');
    });

    it('should handle single occurrences', () => {
      expect(collapseChar('foo/bar', '/')).toBe('foo/bar');
    });

    it('should handle empty string', () => {
      expect(collapseChar('', '/')).toBe('');
    });

    it('should handle all same character', () => {
      expect(collapseChar('////', '/')).toBe('/');
    });
  });

  describe('collapseWhitespace', () => {
    it('should collapse multiple spaces', () => {
      expect(collapseWhitespace('hello   world')).toBe('hello world');
    });

    it('should collapse different whitespace types', () => {
      expect(collapseWhitespace('hello\n\n\tworld')).toBe('hello world');
    });

    it('should handle empty string', () => {
      expect(collapseWhitespace('')).toBe('');
    });

    it('should return original for input exceeding max length', () => {
      const longInput = 'a   '.repeat(20000);
      expect(collapseWhitespace(longInput)).toBe(longInput);
    });
  });

  describe('ReDoS protection - timing tests', () => {
    const TIMEOUT_MS = 100;

    it('should handle pathological input for trimBoth quickly', () => {
      // Pattern that would cause ReDoS with /^\/+|\/+$/g
      const malicious = '/' + '/a'.repeat(1000) + '/';
      const start = Date.now();
      trimBoth(malicious, '/');
      expect(Date.now() - start).toBeLessThan(TIMEOUT_MS);
    });

    it('should handle long sequences efficiently', () => {
      const longInput = '/'.repeat(10000);
      const start = Date.now();
      trimBoth(longInput, '/');
      expect(Date.now() - start).toBeLessThan(TIMEOUT_MS);
    });

    it('should handle pathological template input', () => {
      const malicious = '{' + 'a{'.repeat(100) + '}';
      const start = Date.now();
      extractBracedParams(malicious);
      expect(Date.now() - start).toBeLessThan(TIMEOUT_MS);
    });
  });
});
