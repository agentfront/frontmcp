/**
 * Pattern Matching Utilities Tests
 */
import { StoragePatternError } from '../errors';
import { createGlobMatcher, escapeGlob, globToRegex, matchesPattern, validatePattern } from '../utils/pattern';

describe('Pattern Matching Utilities', () => {
  describe('globToRegex', () => {
    describe('basic patterns', () => {
      it('should match exact strings', () => {
        const regex = globToRegex('user:123');
        expect(regex.test('user:123')).toBe(true);
        expect(regex.test('user:124')).toBe(false);
        expect(regex.test('user:1234')).toBe(false);
      });

      it('should match empty pattern (matches everything)', () => {
        const regex = globToRegex('');
        expect(regex.test('')).toBe(true);
        expect(regex.test('anything')).toBe(true);
        expect(regex.test('user:123')).toBe(true);
      });

      it('should match single asterisk (matches everything)', () => {
        const regex = globToRegex('*');
        expect(regex.test('')).toBe(true);
        expect(regex.test('anything')).toBe(true);
        expect(regex.test('user:123:profile')).toBe(true);
      });
    });

    describe('asterisk wildcard (*)', () => {
      it('should match prefix patterns', () => {
        const regex = globToRegex('user:*');
        expect(regex.test('user:')).toBe(true);
        expect(regex.test('user:123')).toBe(true);
        expect(regex.test('user:abc:def')).toBe(true);
        expect(regex.test('other:123')).toBe(false);
      });

      it('should match suffix patterns', () => {
        const regex = globToRegex('*:profile');
        expect(regex.test(':profile')).toBe(true);
        expect(regex.test('user:profile')).toBe(true);
        expect(regex.test('user:123:profile')).toBe(true);
        expect(regex.test('profile')).toBe(false);
      });

      it('should match middle patterns', () => {
        const regex = globToRegex('user:*:profile');
        expect(regex.test('user::profile')).toBe(true);
        expect(regex.test('user:123:profile')).toBe(true);
        expect(regex.test('user:abc:def:profile')).toBe(true);
        expect(regex.test('user:profile')).toBe(false);
        expect(regex.test('user:123')).toBe(false);
      });

      it('should collapse consecutive asterisks', () => {
        const regex = globToRegex('user:*****:profile');
        expect(regex.test('user::profile')).toBe(true);
        expect(regex.test('user:123:profile')).toBe(true);
      });
    });

    describe('question mark wildcard (?)', () => {
      it('should match single character', () => {
        const regex = globToRegex('user:???');
        expect(regex.test('user:abc')).toBe(true);
        expect(regex.test('user:123')).toBe(true);
        expect(regex.test('user:ab')).toBe(false);
        expect(regex.test('user:abcd')).toBe(false);
      });

      it('should match specific positions', () => {
        const regex = globToRegex('a?c');
        expect(regex.test('abc')).toBe(true);
        expect(regex.test('aXc')).toBe(true);
        expect(regex.test('ac')).toBe(false);
        expect(regex.test('abbc')).toBe(false);
      });

      it('should work with asterisk', () => {
        const regex = globToRegex('user:?*');
        expect(regex.test('user:a')).toBe(true);
        expect(regex.test('user:abc')).toBe(true);
        expect(regex.test('user:')).toBe(false);
      });
    });

    describe('special characters escaping', () => {
      it('should escape regex special characters', () => {
        const regex = globToRegex('user.name[test]');
        expect(regex.test('user.name[test]')).toBe(true);
        expect(regex.test('userXname[test]')).toBe(false);
      });

      it('should handle parentheses', () => {
        const regex = globToRegex('func(arg)');
        expect(regex.test('func(arg)')).toBe(true);
        expect(regex.test('funcXargX')).toBe(false);
      });

      it('should handle curly braces', () => {
        const regex = globToRegex('data:{id}');
        expect(regex.test('data:{id}')).toBe(true);
      });

      it('should handle caret and dollar', () => {
        const regex = globToRegex('^start$end');
        expect(regex.test('^start$end')).toBe(true);
      });

      it('should read a backslash as making the next character literal', () => {
        // The pattern `path\\file` (an escaped backslash) matches the key `path\file`.
        expect(globToRegex('path\\\\file').test('path\\file')).toBe(true);
        // `\f` in a pattern is a literal `f`, as in Redis SCAN MATCH.
        expect(globToRegex('path\\file').test('pathfile')).toBe(true);
        expect(globToRegex('a\\*b').test('a*b')).toBe(true);
        expect(globToRegex('a\\*b').test('axxb')).toBe(false);
      });

      it('should keep a trailing lone backslash literal', () => {
        expect(globToRegex('end\\').test('end\\')).toBe(true);
      });
    });

    describe('ReDoS protection', () => {
      it('should reject patterns exceeding maximum length', () => {
        const longPattern = 'a'.repeat(501);
        expect(() => globToRegex(longPattern)).toThrow(StoragePatternError);
        expect(() => globToRegex(longPattern)).toThrow('exceeds maximum length');
      });

      it('should accept patterns at maximum length', () => {
        const maxPattern = 'a'.repeat(500);
        expect(() => globToRegex(maxPattern)).not.toThrow();
      });

      it('should reject patterns with too many wildcards', () => {
        const manyWildcards = '*'.repeat(21);
        expect(() => globToRegex(manyWildcards)).toThrow(StoragePatternError);
        expect(() => globToRegex(manyWildcards)).toThrow('too many wildcards');
      });

      it('should accept patterns at maximum wildcard count', () => {
        const maxWildcards = '*?'.repeat(10); // 20 wildcards
        expect(() => globToRegex(maxWildcards)).not.toThrow();
      });
    });
  });

  describe('matchesPattern', () => {
    it('should return true for matching keys', () => {
      expect(matchesPattern('user:123:profile', 'user:*:profile')).toBe(true);
      expect(matchesPattern('session:abc', 'session:???')).toBe(true);
    });

    it('should return false for non-matching keys', () => {
      expect(matchesPattern('other:key', 'user:*')).toBe(false);
      expect(matchesPattern('session:ab', 'session:???')).toBe(false);
    });

    it('should match keys that contain line breaks', () => {
      expect(matchesPattern('user:a\nb:profile', 'user:*:profile')).toBe(true);
      expect(matchesPattern('x\ny', 'x?y')).toBe(true);
    });
  });

  describe('createGlobMatcher', () => {
    const cases: Array<[pattern: string, key: string, expected: boolean]> = [
      ['', '', true],
      ['', 'anything', true],
      ['*', '', true],
      ['*', 'a:b:c', true],
      ['user:*', 'user:', true],
      ['user:*', 'other:1', false],
      ['*:profile', 'user:1:profile', true],
      ['*:profile', 'profile', false],
      ['user:*:profile', 'user::profile', true],
      ['user:*:profile', 'user:profile', false],
      ['user:*****:profile', 'user:x:profile', true],
      ['session:???', 'session:abc', true],
      ['session:???', 'session:ab', false],
      ['session:???', 'session:abcd', false],
      ['a*b*c', 'aXbYc', true],
      ['a*b*c', 'aXbY', false],
      ['*a*', 'bab', true],
      ['*?', '', false],
      ['*?', 'x', true],
      ['a.b', 'a.b', true],
      ['a.b', 'axb', false],
    ];

    it.each(cases)('matches %j against %j as %s', (pattern, key, expected) => {
      expect(createGlobMatcher(pattern)(key)).toBe(expected);
      expect(globToRegex(pattern).test(key)).toBe(expected);
    });

    it('should treat escapeGlob output as the literal string', () => {
      const literal = 'us*er?\\id';
      const isLiteral = createGlobMatcher(`key:${escapeGlob(literal)}:*`);
      expect(isLiteral('key:us*er?\\id:1')).toBe(true);
      expect(isLiteral('key:usXXerY\\id:1')).toBe(false);
      expect(isLiteral('key:us*er?Xid:1')).toBe(false);
    });

    it('should not count escaped wildcards toward the wildcard limit', () => {
      expect(() => createGlobMatcher('\\*'.repeat(30))).not.toThrow();
      expect(() => createGlobMatcher('*a'.repeat(21))).toThrow('too many wildcards');
    });

    it('should answer a pattern that a backtracking regular expression could not', () => {
      // As a regular expression, this pattern on this key backtracks for longer than any test run.
      const pattern = '*a'.repeat(20) + 'b';
      const key = 'a'.repeat(5000);
      expect(createGlobMatcher(pattern)(key)).toBe(false);
      expect(createGlobMatcher(pattern)(key + 'b')).toBe(true);
    });
  });

  describe('validatePattern', () => {
    it('should return valid for good patterns', () => {
      expect(validatePattern('user:*')).toEqual({ valid: true });
      expect(validatePattern('session:???')).toEqual({ valid: true });
      expect(validatePattern('exact:key')).toEqual({ valid: true });
    });

    it('should return error for invalid patterns', () => {
      const result = validatePattern('a'.repeat(501));
      expect(result.valid).toBe(false);
      expect(result.error).toContain('exceeds maximum length');
    });

    it('should return error for too many wildcards', () => {
      const result = validatePattern('*'.repeat(21));
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too many wildcards');
    });
  });

  describe('escapeGlob', () => {
    it('should escape asterisk', () => {
      expect(escapeGlob('user*123')).toBe('user\\*123');
    });

    it('should escape question mark', () => {
      expect(escapeGlob('user?123')).toBe('user\\?123');
    });

    it('should escape backslash', () => {
      expect(escapeGlob('path\\file')).toBe('path\\\\file');
    });

    it('should escape multiple special characters', () => {
      expect(escapeGlob('a*b?c\\d')).toBe('a\\*b\\?c\\\\d');
    });

    it('should not modify strings without special characters', () => {
      expect(escapeGlob('user:123:profile')).toBe('user:123:profile');
    });

    it('should produce a pattern that matches only the literal string', () => {
      // Redis SCAN MATCH reads these escapes too, so the same pattern works on every backend.
      const id = 'user*123?';
      const escaped = escapeGlob(id);
      expect(escaped).toBe('user\\*123\\?');
      expect(matchesPattern(id, escaped)).toBe(true);
      expect(matchesPattern('userX123Y', escaped)).toBe(false);
    });
  });
});
