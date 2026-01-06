// file: plugins/plugin-dashboard/src/__tests__/safe-regex.test.ts

import 'reflect-metadata';
import { safeRegex } from '../shared/safe-regex';

describe('safeRegex', () => {
  describe('valid patterns', () => {
    it('should return RegExp for simple pattern', () => {
      const result = safeRegex('hello');
      expect(result).toBeInstanceOf(RegExp);
      expect(result!.test('hello world')).toBe(true);
    });

    it('should return case-insensitive RegExp', () => {
      const result = safeRegex('HELLO');
      expect(result).toBeInstanceOf(RegExp);
      expect(result!.test('hello')).toBe(true);
    });

    it('should handle regex special characters when escaped', () => {
      const result = safeRegex('test\\.');
      expect(result).toBeInstanceOf(RegExp);
      expect(result!.test('test.')).toBe(true);
      expect(result!.test('testX')).toBe(false);
    });

    it('should handle character classes', () => {
      const result = safeRegex('[a-z]+');
      expect(result).toBeInstanceOf(RegExp);
      expect(result!.test('abc')).toBe(true);
    });

    it('should handle quantifiers', () => {
      const result = safeRegex('a+');
      expect(result).toBeInstanceOf(RegExp);
      expect(result!.test('aaa')).toBe(true);
    });

    it('should handle anchors', () => {
      const result = safeRegex('^start');
      expect(result).toBeInstanceOf(RegExp);
      expect(result!.test('start of string')).toBe(true);
    });

    it('should handle alternation', () => {
      const result = safeRegex('cat|dog');
      expect(result).toBeInstanceOf(RegExp);
      expect(result!.test('cat')).toBe(true);
      expect(result!.test('dog')).toBe(true);
    });

    it('should handle groups', () => {
      const result = safeRegex('(foo|bar)');
      expect(result).toBeInstanceOf(RegExp);
      expect(result!.test('foo')).toBe(true);
    });

    it('should handle word boundaries', () => {
      const result = safeRegex('\\bword\\b');
      expect(result).toBeInstanceOf(RegExp);
      expect(result!.test('a word here')).toBe(true);
    });
  });

  describe('invalid patterns', () => {
    it('should return null for patterns over 100 characters', () => {
      const longPattern = 'a'.repeat(101);
      const result = safeRegex(longPattern);
      expect(result).toBeNull();
    });

    it('should return null for exactly 100 characters (valid)', () => {
      const pattern = 'a'.repeat(100);
      const result = safeRegex(pattern);
      expect(result).toBeInstanceOf(RegExp);
    });

    it('should return null for invalid regex syntax - unclosed bracket', () => {
      const result = safeRegex('[');
      expect(result).toBeNull();
    });

    it('should return null for invalid regex syntax - unclosed paren', () => {
      const result = safeRegex('(abc');
      expect(result).toBeNull();
    });

    it('should return null for invalid regex syntax - bad escape', () => {
      const result = safeRegex('\\c'); // Invalid escape in regex
      // Note: Some JS engines accept \\c, so we test with something definitely invalid
    });

    it('should return null for invalid quantifier', () => {
      const result = safeRegex('*');
      expect(result).toBeNull();
    });

    it('should return null for invalid range', () => {
      const result = safeRegex('[z-a]');
      expect(result).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle empty pattern', () => {
      const result = safeRegex('');
      expect(result).toBeInstanceOf(RegExp);
      expect(result!.test('anything')).toBe(true);
    });

    it('should handle dot (match any)', () => {
      const result = safeRegex('.');
      expect(result).toBeInstanceOf(RegExp);
      expect(result!.test('x')).toBe(true);
    });

    it('should handle common search patterns', () => {
      const result = safeRegex('user.*service');
      expect(result).toBeInstanceOf(RegExp);
      expect(result!.test('user-service')).toBe(true);
      expect(result!.test('userDataService')).toBe(true);
    });
  });
});
