/**
 * Tests for regex utilities and ReDoS protection
 */

import { isPotentiallyVulnerableRegex, createSafeRegex, safeTest, SAFE_PATTERNS } from '../regex.utils';

describe('Regex Utilities', () => {
  describe('isPotentiallyVulnerableRegex', () => {
    describe('vulnerable patterns', () => {
      it('should detect nested quantifiers - (a+)+', () => {
        expect(isPotentiallyVulnerableRegex('(a+)+$')).toBe(true);
      });

      it('should detect nested quantifiers - (a*)*', () => {
        expect(isPotentiallyVulnerableRegex('(a*)*')).toBe(true);
      });

      it('should detect nested quantifiers with curly braces - (a{1,3})+', () => {
        expect(isPotentiallyVulnerableRegex('(a{1,3})+')).toBe(true);
      });

      it('should detect alternation with overlapping patterns - (a|ab)*', () => {
        expect(isPotentiallyVulnerableRegex('(a|ab)*$')).toBe(true);
      });

      it('should detect alternation with quantifiers - (x|xy)+', () => {
        expect(isPotentiallyVulnerableRegex('(x|xy)+')).toBe(true);
      });

      it('should detect repeated groups with quantifiers - (a+)+', () => {
        expect(isPotentiallyVulnerableRegex('(a+)+')).toBe(true);
      });

      it('should detect complex nested quantifiers - ((a+)+)+', () => {
        expect(isPotentiallyVulnerableRegex('((a+)+)+')).toBe(true);
      });

      it('should detect alternation with star quantifier - (foo|foobar)*', () => {
        expect(isPotentiallyVulnerableRegex('(foo|foobar)*')).toBe(true);
      });
    });

    describe('safe patterns', () => {
      it('should not flag simple character class as vulnerable', () => {
        expect(isPotentiallyVulnerableRegex('[a-zA-Z0-9]+')).toBe(false);
      });

      it('should not flag simple alternation without quantifiers', () => {
        expect(isPotentiallyVulnerableRegex('(foo|bar)')).toBe(false);
      });

      it('should not flag single quantifier without nesting', () => {
        expect(isPotentiallyVulnerableRegex('a+')).toBe(false);
      });

      it('should not flag word boundary patterns', () => {
        expect(isPotentiallyVulnerableRegex('\\b\\w+\\b')).toBe(false);
      });

      it('should not flag digit patterns', () => {
        expect(isPotentiallyVulnerableRegex('\\d{1,3}')).toBe(false);
      });

      it('should not flag simple dot pattern', () => {
        expect(isPotentiallyVulnerableRegex('.*')).toBe(false);
      });

      it('should not flag negated character class', () => {
        expect(isPotentiallyVulnerableRegex('[^a-z]+')).toBe(false);
      });
    });
  });

  describe('createSafeRegex', () => {
    it('should create a function that matches valid input', () => {
      const safeRegex = createSafeRegex('[a-z]+');
      const result = safeRegex('hello');

      expect(result).not.toBeNull();
      expect(result![0]).toBe('hello');
    });

    it('should create a function that handles non-matching input', () => {
      const safeRegex = createSafeRegex('^[0-9]+$');
      const result = safeRegex('abc');

      expect(result).toBeNull();
    });

    it('should accept RegExp object as pattern', () => {
      const pattern = /test/i;
      const safeRegex = createSafeRegex(pattern);
      const result = safeRegex('TEST');

      expect(result).not.toBeNull();
      expect(result![0]).toBe('TEST');
    });

    it('should accept flags parameter', () => {
      const safeRegex = createSafeRegex('hello', 'i');
      const result = safeRegex('HELLO');

      expect(result).not.toBeNull();
      expect(result![0]).toBe('HELLO');
    });

    it('should truncate input longer than 10000 characters', () => {
      const safeRegex = createSafeRegex('a+');
      const longInput = 'a'.repeat(15000);
      const result = safeRegex(longInput);

      expect(result).not.toBeNull();
      // Input should be truncated to 10000 chars
      expect(result![0]).toHaveLength(10000);
    });

    it('should handle never-matching patterns', () => {
      const safeRegex = createSafeRegex('(?!)'); // Negative lookahead that never matches
      const result = safeRegex('test');

      expect(result).toBeNull();
    });

    it('should work with global flag', () => {
      const safeRegex = createSafeRegex('\\d+', 'g');
      const result = safeRegex('123 456');

      expect(result).not.toBeNull();
      expect(result![0]).toBe('123');
    });

    it('should handle empty input', () => {
      const safeRegex = createSafeRegex('.*');
      const result = safeRegex('');

      expect(result).not.toBeNull();
      expect(result![0]).toBe('');
    });

    it('should handle complex patterns safely', () => {
      const safeRegex = createSafeRegex('\\b[A-Z][a-z]+\\b');
      const result = safeRegex('Hello World');

      expect(result).not.toBeNull();
      expect(result![0]).toBe('Hello');
    });
  });

  describe('safeTest', () => {
    it('should return true for matching pattern', () => {
      const pattern = /^[a-z]+$/;
      expect(safeTest('hello', pattern)).toBe(true);
    });

    it('should return false for non-matching pattern', () => {
      const pattern = /^[0-9]+$/;
      expect(safeTest('abc', pattern)).toBe(false);
    });

    it('should return false for input exceeding maxLength', () => {
      const pattern = /a+/;
      const longInput = 'a'.repeat(15000);

      expect(safeTest(longInput, pattern, 10000)).toBe(false);
    });

    it('should use default maxLength of 10000', () => {
      const pattern = /a+/;
      const input = 'a'.repeat(9999);

      expect(safeTest(input, pattern)).toBe(true);
    });

    it('should accept custom maxLength', () => {
      const pattern = /test/;
      const input = 'test';

      expect(safeTest(input, pattern, 100)).toBe(true);
    });

    it('should handle never-matching patterns', () => {
      const pattern = /(?!)/; // Negative lookahead that never matches
      expect(safeTest('test', pattern)).toBe(false);
    });

    it('should work with case-insensitive patterns', () => {
      const pattern = /hello/i;
      expect(safeTest('HELLO', pattern)).toBe(true);
    });

    it('should work with multiline patterns', () => {
      const pattern = /^test$/m;
      expect(safeTest('foo\ntest\nbar', pattern)).toBe(true);
    });

    it('should return false for empty string with strict pattern', () => {
      const pattern = /^[a-z]+$/;
      expect(safeTest('', pattern)).toBe(false);
    });

    it('should handle special regex characters', () => {
      const pattern = /\d{3}-\d{4}/;
      expect(safeTest('123-4567', pattern)).toBe(true);
    });

    it('should enforce length limit strictly', () => {
      const pattern = /a+/;
      const input = 'a'.repeat(101);

      expect(safeTest(input, pattern, 100)).toBe(false);
    });
  });

  describe('SAFE_PATTERNS', () => {
    it('should have CONTROL_CHARS pattern', () => {
      expect(SAFE_PATTERNS.CONTROL_CHARS).toBeInstanceOf(RegExp);
      expect(SAFE_PATTERNS.CONTROL_CHARS.global).toBe(true);
    });

    it('CONTROL_CHARS should match newlines', () => {
      expect('test\n'.replace(SAFE_PATTERNS.CONTROL_CHARS, '')).toBe('test');
    });

    it('CONTROL_CHARS should match carriage returns', () => {
      expect('test\r'.replace(SAFE_PATTERNS.CONTROL_CHARS, '')).toBe('test');
    });

    it('CONTROL_CHARS should match tabs', () => {
      expect('test\t'.replace(SAFE_PATTERNS.CONTROL_CHARS, '')).toBe('test');
    });

    it('CONTROL_CHARS should match null bytes', () => {
      expect('test\0'.replace(SAFE_PATTERNS.CONTROL_CHARS, '')).toBe('test');
    });

    it('should have PATH_SEPARATORS pattern', () => {
      expect(SAFE_PATTERNS.PATH_SEPARATORS).toBeInstanceOf(RegExp);
      expect(SAFE_PATTERNS.PATH_SEPARATORS.global).toBe(true);
    });

    it('PATH_SEPARATORS should match forward slash', () => {
      expect('test/path'.replace(SAFE_PATTERNS.PATH_SEPARATORS, '-')).toBe('test-path');
    });

    it('PATH_SEPARATORS should match backslash', () => {
      expect('test\\path'.replace(SAFE_PATTERNS.PATH_SEPARATORS, '-')).toBe('test-path');
    });

    it('should have DIR_TRAVERSAL pattern', () => {
      expect(SAFE_PATTERNS.DIR_TRAVERSAL).toBeInstanceOf(RegExp);
      expect(SAFE_PATTERNS.DIR_TRAVERSAL.global).toBe(true);
    });

    it('DIR_TRAVERSAL should match double dots', () => {
      expect('../test/..'.replace(SAFE_PATTERNS.DIR_TRAVERSAL, '')).toBe('/test/');
    });

    it('should have ALPHANUMERIC_SAFE pattern', () => {
      expect(SAFE_PATTERNS.ALPHANUMERIC_SAFE).toBeInstanceOf(RegExp);
      expect(SAFE_PATTERNS.ALPHANUMERIC_SAFE.global).toBe(true);
    });

    it('ALPHANUMERIC_SAFE should keep word characters', () => {
      expect('test123_ABC'.replace(SAFE_PATTERNS.ALPHANUMERIC_SAFE, '')).toBe('test123_ABC');
    });

    it('ALPHANUMERIC_SAFE should keep hyphens', () => {
      expect('test-name'.replace(SAFE_PATTERNS.ALPHANUMERIC_SAFE, '')).toBe('test-name');
    });

    it('ALPHANUMERIC_SAFE should remove special characters', () => {
      expect('test@#$%'.replace(SAFE_PATTERNS.ALPHANUMERIC_SAFE, '')).toBe('test');
    });

    it('should have REDIS_KEY_SAFE pattern', () => {
      expect(SAFE_PATTERNS.REDIS_KEY_SAFE).toBeInstanceOf(RegExp);
      expect(SAFE_PATTERNS.REDIS_KEY_SAFE.global).toBe(true);
    });

    it('REDIS_KEY_SAFE should keep word characters, colons, dots, dashes', () => {
      expect('test:key.name-1'.replace(SAFE_PATTERNS.REDIS_KEY_SAFE, '')).toBe('test:key.name-1');
    });

    it('REDIS_KEY_SAFE should remove unsafe characters', () => {
      expect('test@#$%'.replace(SAFE_PATTERNS.REDIS_KEY_SAFE, '')).toBe('test');
    });

    it('should have LEADING_DOTS_DASHES pattern', () => {
      expect(SAFE_PATTERNS.LEADING_DOTS_DASHES).toBeInstanceOf(RegExp);
    });

    it('LEADING_DOTS_DASHES should match leading dots', () => {
      expect('...test'.replace(SAFE_PATTERNS.LEADING_DOTS_DASHES, '')).toBe('test');
    });

    it('LEADING_DOTS_DASHES should match leading dashes', () => {
      expect('---test'.replace(SAFE_PATTERNS.LEADING_DOTS_DASHES, '')).toBe('test');
    });

    it('LEADING_DOTS_DASHES should match mixed leading dots and dashes', () => {
      expect('.-.-test'.replace(SAFE_PATTERNS.LEADING_DOTS_DASHES, '')).toBe('test');
    });

    it('should have TRAILING_DOTS_DASHES pattern', () => {
      expect(SAFE_PATTERNS.TRAILING_DOTS_DASHES).toBeInstanceOf(RegExp);
    });

    it('TRAILING_DOTS_DASHES should match trailing dots', () => {
      expect('test...'.replace(SAFE_PATTERNS.TRAILING_DOTS_DASHES, '')).toBe('test');
    });

    it('TRAILING_DOTS_DASHES should match trailing dashes', () => {
      expect('test---'.replace(SAFE_PATTERNS.TRAILING_DOTS_DASHES, '')).toBe('test');
    });

    it('TRAILING_DOTS_DASHES should match mixed trailing dots and dashes', () => {
      expect('test.-.-'.replace(SAFE_PATTERNS.TRAILING_DOTS_DASHES, '')).toBe('test');
    });

    it('all SAFE_PATTERNS should not be vulnerable to ReDoS', () => {
      expect(isPotentiallyVulnerableRegex(SAFE_PATTERNS.CONTROL_CHARS.source)).toBe(false);
      expect(isPotentiallyVulnerableRegex(SAFE_PATTERNS.PATH_SEPARATORS.source)).toBe(false);
      expect(isPotentiallyVulnerableRegex(SAFE_PATTERNS.DIR_TRAVERSAL.source)).toBe(false);
      expect(isPotentiallyVulnerableRegex(SAFE_PATTERNS.ALPHANUMERIC_SAFE.source)).toBe(false);
      expect(isPotentiallyVulnerableRegex(SAFE_PATTERNS.REDIS_KEY_SAFE.source)).toBe(false);
      expect(isPotentiallyVulnerableRegex(SAFE_PATTERNS.LEADING_DOTS_DASHES.source)).toBe(false);
      expect(isPotentiallyVulnerableRegex(SAFE_PATTERNS.TRAILING_DOTS_DASHES.source)).toBe(false);
    });
  });
});
