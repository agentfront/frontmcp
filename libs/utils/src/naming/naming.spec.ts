import { splitWords, toCase, sepFor, shortHash, ensureMaxLen, idFromString, NameCase } from './naming';

describe('Naming Utils', () => {
  describe('splitWords', () => {
    it('should split camelCase', () => {
      expect(splitWords('myFunctionName')).toEqual(['my', 'Function', 'Name']);
    });

    it('should split PascalCase', () => {
      expect(splitWords('MyClassName')).toEqual(['My', 'Class', 'Name']);
    });

    it('should split snake_case', () => {
      expect(splitWords('my_function_name')).toEqual(['my', 'function', 'name']);
    });

    it('should split kebab-case', () => {
      expect(splitWords('my-function-name')).toEqual(['my', 'function', 'name']);
    });

    it('should handle multiple consecutive delimiters', () => {
      expect(splitWords('my__function')).toEqual(['my', 'function']);
    });

    it('should handle empty string', () => {
      expect(splitWords('')).toEqual([]);
    });

    it('should handle single word', () => {
      expect(splitWords('word')).toEqual(['word']);
    });

    it('should handle numbers followed by uppercase (no split)', () => {
      // splitWords only splits on lowercase->uppercase transition, not digit->uppercase
      expect(splitWords('function123Name')).toEqual(['function123Name']);
    });

    it('should handle numbers after uppercase', () => {
      expect(splitWords('Name123')).toEqual(['Name123']);
    });
  });

  describe('toCase', () => {
    const words = ['my', 'function', 'name'];

    it('should convert to snake_case', () => {
      expect(toCase(words, 'snake')).toBe('my_function_name');
    });

    it('should convert to kebab-case', () => {
      expect(toCase(words, 'kebab')).toBe('my-function-name');
    });

    it('should convert to dot.case', () => {
      expect(toCase(words, 'dot')).toBe('my.function.name');
    });

    it('should convert to camelCase', () => {
      expect(toCase(words, 'camel')).toBe('myFunctionName');
    });

    it('should handle empty array', () => {
      expect(toCase([], 'snake')).toBe('');
      expect(toCase([], 'camel')).toBe('');
    });

    it('should handle single word', () => {
      expect(toCase(['word'], 'camel')).toBe('word');
      expect(toCase(['Word'], 'camel')).toBe('word');
    });

    it('should lowercase all words in snake/kebab/dot', () => {
      expect(toCase(['MY', 'FUNCTION'], 'snake')).toBe('my_function');
    });
  });

  describe('sepFor', () => {
    it('should return _ for snake', () => {
      expect(sepFor('snake')).toBe('_');
    });

    it('should return - for kebab', () => {
      expect(sepFor('kebab')).toBe('-');
    });

    it('should return . for dot', () => {
      expect(sepFor('dot')).toBe('.');
    });

    it('should return empty string for camel', () => {
      expect(sepFor('camel')).toBe('');
    });
  });

  describe('shortHash', () => {
    it('should return 6-character hex string', () => {
      const hash = shortHash('test');
      expect(hash).toHaveLength(6);
      expect(/^[0-9a-f]{6}$/.test(hash)).toBe(true);
    });

    it('should return consistent hash for same input', () => {
      expect(shortHash('hello')).toBe(shortHash('hello'));
    });

    it('should return different hash for different input', () => {
      expect(shortHash('hello')).not.toBe(shortHash('world'));
    });

    it('should handle empty string', () => {
      const hash = shortHash('');
      expect(hash).toHaveLength(6);
    });
  });

  describe('ensureMaxLen', () => {
    it('should return short names unchanged', () => {
      expect(ensureMaxLen('short', 20)).toBe('short');
    });

    it('should truncate long names with hash', () => {
      const result = ensureMaxLen('very-long-name-that-exceeds-limit', 20);
      expect(result.length).toBeLessThanOrEqual(20);
      expect(result).toContain('-');
    });

    it('should preserve meaningful suffix', () => {
      const result = ensureMaxLen('prefix-suffix', 15);
      expect(result).toContain('suffix');
    });

    it('should handle names at exact limit', () => {
      const name = '12345678901234567890'; // 20 chars
      expect(ensureMaxLen(name, 20)).toBe(name);
    });
  });

  describe('idFromString', () => {
    it('should replace invalid characters with hyphens', () => {
      expect(idFromString('My Function Name!')).toBe('My-Function-Name');
    });

    it('should remove leading/trailing hyphens', () => {
      expect(idFromString('!hello!')).toBe('hello');
    });

    it('should limit to 64 characters', () => {
      const longName = 'a'.repeat(100);
      expect(idFromString(longName).length).toBe(64);
    });

    it('should handle already valid names', () => {
      expect(idFromString('valid-name_123')).toBe('valid-name_123');
    });

    it('should collapse multiple invalid chars to single hyphen', () => {
      expect(idFromString('foo@#$bar')).toBe('foo-bar');
    });

    it('should handle empty string', () => {
      expect(idFromString('')).toBe('');
    });
  });
});
