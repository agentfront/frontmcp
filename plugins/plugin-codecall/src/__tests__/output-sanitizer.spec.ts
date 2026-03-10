/**
 * Tests for output-sanitizer.ts
 */

import {
  sanitizeOutput,
  needsSanitization,
  sanitizeLogMessage,
  DEFAULT_SANITIZER_CONFIG,
} from '../services/output-sanitizer';

describe('DEFAULT_SANITIZER_CONFIG', () => {
  it('should have correct default values', () => {
    expect(DEFAULT_SANITIZER_CONFIG.maxDepth).toBe(10);
    expect(DEFAULT_SANITIZER_CONFIG.maxStringLength).toBe(10000);
    expect(DEFAULT_SANITIZER_CONFIG.maxObjectKeys).toBe(100);
    expect(DEFAULT_SANITIZER_CONFIG.maxArrayLength).toBe(1000);
    expect(DEFAULT_SANITIZER_CONFIG.maxTotalSize).toBe(1024 * 1024);
    expect(DEFAULT_SANITIZER_CONFIG.removeStackTraces).toBe(true);
    expect(DEFAULT_SANITIZER_CONFIG.removeFilePaths).toBe(true);
  });

  it('should be frozen', () => {
    expect(Object.isFrozen(DEFAULT_SANITIZER_CONFIG)).toBe(true);
  });
});

describe('sanitizeOutput', () => {
  describe('primitive values', () => {
    it('should pass through null', () => {
      const result = sanitizeOutput(null);
      expect(result.value).toBeNull();
      expect(result.wasModified).toBe(false);
    });

    it('should pass through undefined', () => {
      const result = sanitizeOutput(undefined);
      expect(result.value).toBeUndefined();
      expect(result.wasModified).toBe(false);
    });

    it('should pass through numbers', () => {
      const result = sanitizeOutput(42);
      expect(result.value).toBe(42);
      expect(result.wasModified).toBe(false);
    });

    it('should pass through booleans', () => {
      const result = sanitizeOutput(true);
      expect(result.value).toBe(true);
      expect(result.wasModified).toBe(false);
    });

    it('should convert bigint to string', () => {
      const result = sanitizeOutput(BigInt(12345));
      expect(result.value).toBe('12345');
    });

    it('should convert symbol to string', () => {
      const result = sanitizeOutput(Symbol('test'));
      expect(result.value).toBe('Symbol(test)');
    });
  });

  describe('string sanitization', () => {
    it('should pass through simple strings', () => {
      const result = sanitizeOutput('hello world');
      expect(result.value).toBe('hello world');
      expect(result.wasModified).toBe(false);
    });

    it('should remove Unix file paths', () => {
      const result = sanitizeOutput('Error in /home/user/app/lib/file.ts');
      expect(result.value).toBe('Error in [path]');
      expect(result.wasModified).toBe(true);
      expect(result.warnings).toContain('File paths removed from string');
    });

    it('should remove Windows file paths', () => {
      const result = sanitizeOutput('Error at C:\\Users\\test\\app\\file.ts');
      expect(result.value).toBe('Error at [path]');
      expect(result.wasModified).toBe(true);
    });

    it('should truncate long strings', () => {
      const longString = 'a'.repeat(15000);
      const result = sanitizeOutput(longString);
      expect((result.value as string).length).toBeLessThanOrEqual(10015); // 10000 + '...[truncated]'
      expect(result.value).toContain('...[truncated]');
      expect(result.wasModified).toBe(true);
    });
  });

  describe('function handling', () => {
    it('should replace functions with placeholder', () => {
      const result = sanitizeOutput(function test() {});
      expect(result.value).toBe('[function]');
      expect(result.warnings).toContain('Function removed from output');
    });

    it('should replace arrow functions with placeholder', () => {
      const result = sanitizeOutput(() => 'test');
      expect(result.value).toBe('[function]');
    });
  });

  describe('object sanitization', () => {
    it('should sanitize simple objects', () => {
      const result = sanitizeOutput({ name: 'test', count: 5 });
      expect(result.value).toEqual({ name: 'test', count: 5 });
      expect(result.wasModified).toBe(false);
    });

    it('should handle objects with dangerous keys', () => {
      // When we explicitly set dangerous keys, they should be removed from the output
      const result = sanitizeOutput({ prototype: 'bad', data: 'test' });
      // The sanitizer should remove dangerous keys from enumerable keys
      expect(result.warnings.some((w) => w.includes('Dangerous key'))).toBe(true);
    });

    it('should truncate objects with too many keys', () => {
      const obj: Record<string, number> = {};
      for (let i = 0; i < 150; i++) {
        obj[`key${i}`] = i;
      }
      const result = sanitizeOutput(obj);
      const keys = Object.keys(result.value as object);
      expect(keys.length).toBeLessThanOrEqual(100);
      expect(result.warnings.some((w) => w.includes('truncated'))).toBe(true);
    });

    it('should handle nested objects', () => {
      const result = sanitizeOutput({
        level1: {
          level2: {
            value: 'deep',
          },
        },
      });
      expect((result.value as any).level1.level2.value).toBe('deep');
    });
  });

  describe('array sanitization', () => {
    it('should sanitize simple arrays', () => {
      const result = sanitizeOutput([1, 2, 3]);
      expect(result.value).toEqual([1, 2, 3]);
    });

    it('should truncate long arrays', () => {
      const arr = Array(1500).fill(1);
      const result = sanitizeOutput(arr);
      expect((result.value as unknown[]).length).toBeLessThanOrEqual(1000);
      expect(result.warnings.some((w) => w.includes('Array truncated'))).toBe(true);
    });

    it('should sanitize nested arrays', () => {
      const result = sanitizeOutput([
        [1, 2],
        [3, 4],
      ]);
      expect(result.value).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });
  });

  describe('circular reference handling', () => {
    it('should detect and handle circular references', () => {
      const obj: any = { name: 'test' };
      obj.self = obj;
      const result = sanitizeOutput(obj);
      expect((result.value as any).self).toBe('[circular]');
      expect(result.warnings).toContain('Circular reference detected');
    });
  });

  describe('max depth handling', () => {
    it('should stop at max depth', () => {
      const deepObj: any = { level: 0 };
      let current = deepObj;
      for (let i = 1; i <= 15; i++) {
        current.next = { level: i };
        current = current.next;
      }
      const result = sanitizeOutput(deepObj);
      expect(result.warnings.some((w) => w.includes('Max depth'))).toBe(true);
    });
  });

  describe('Error object handling', () => {
    it('should sanitize Error objects', () => {
      const error = new Error('Test error');
      const result = sanitizeOutput(error);
      expect((result.value as any).name).toBe('Error');
      expect((result.value as any).message).toBe('Test error');
    });

    it('should remove stack traces by default', () => {
      const error = new Error('Test error');
      const result = sanitizeOutput(error);
      expect((result.value as any).stack).toBeUndefined();
      expect(result.warnings).toContain('Stack trace removed');
    });

    it('should include stack traces when configured', () => {
      const error = new Error('Test error');
      const result = sanitizeOutput(error, { removeStackTraces: false });
      expect((result.value as any).stack).toBeDefined();
    });

    it('should include error code if present', () => {
      const error: any = new Error('Test error');
      error.code = 'ERR_TEST';
      const result = sanitizeOutput(error);
      expect((result.value as any).code).toBe('ERR_TEST');
    });
  });

  describe('special object types', () => {
    it('should convert Date to ISO string', () => {
      const date = new Date('2024-01-15T12:00:00Z');
      const result = sanitizeOutput(date);
      expect(result.value).toBe('2024-01-15T12:00:00.000Z');
    });

    it('should convert RegExp to string', () => {
      const regex = /test/gi;
      const result = sanitizeOutput(regex);
      expect(result.value).toBe('/test/gi');
    });

    it('should convert Map to object', () => {
      const map = new Map<string, number>([
        ['a', 1],
        ['b', 2],
      ]);
      const result = sanitizeOutput(map);
      expect(result.value).toEqual({ a: 1, b: 2 });
    });

    it('should truncate Map with too many entries', () => {
      const map = new Map<string, number>();
      for (let i = 0; i < 150; i++) {
        map.set(`key${i}`, i);
      }
      const result = sanitizeOutput(map);
      expect(Object.keys(result.value as object).length).toBeLessThanOrEqual(100);
    });

    it('should convert Set to array', () => {
      const set = new Set([1, 2, 3]);
      const result = sanitizeOutput(set);
      expect(result.value).toEqual([1, 2, 3]);
    });

    it('should truncate Set with too many items', () => {
      const set = new Set<number>();
      for (let i = 0; i < 1500; i++) {
        set.add(i);
      }
      const result = sanitizeOutput(set);
      expect((result.value as unknown[]).length).toBeLessThanOrEqual(1000);
    });
  });

  describe('total size limit', () => {
    it('should truncate output exceeding max size', () => {
      const hugeArray = Array(100000).fill({ data: 'x'.repeat(100) });
      const result = sanitizeOutput(hugeArray);
      expect(result.wasModified).toBe(true);
      expect(result.warnings.some((w) => w.includes('exceeded max size') || w.includes('truncated'))).toBe(true);
    });
  });

  describe('serialization errors', () => {
    it('should handle unserializable objects', () => {
      // Create object with circular JSON
      const obj: any = {};
      obj.toJSON = () => {
        throw new Error('Cannot serialize');
      };
      const result = sanitizeOutput(obj);
      expect(result.wasModified).toBe(true);
    });
  });
});

describe('needsSanitization', () => {
  it('should return false for null', () => {
    expect(needsSanitization(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(needsSanitization(undefined)).toBe(false);
  });

  it('should return false for numbers', () => {
    expect(needsSanitization(42)).toBe(false);
    expect(needsSanitization(3.14)).toBe(false);
  });

  it('should return false for booleans', () => {
    expect(needsSanitization(true)).toBe(false);
    expect(needsSanitization(false)).toBe(false);
  });

  it('should return false for short strings without paths', () => {
    expect(needsSanitization('hello')).toBe(false);
  });

  it('should return true for long strings', () => {
    expect(needsSanitization('a'.repeat(150))).toBe(true);
  });

  it('should return true for strings with forward slashes', () => {
    expect(needsSanitization('/path/to/file')).toBe(true);
  });

  it('should return true for strings with backslashes', () => {
    expect(needsSanitization('C:\\path\\to\\file')).toBe(true);
  });

  it('should return true for objects', () => {
    expect(needsSanitization({ key: 'value' })).toBe(true);
  });

  it('should return true for arrays', () => {
    expect(needsSanitization([1, 2, 3])).toBe(true);
  });
});

describe('sanitizeLogMessage', () => {
  it('should return empty string for empty input', () => {
    expect(sanitizeLogMessage('')).toBe('');
  });

  it('should remove Unix file paths', () => {
    const result = sanitizeLogMessage('Error in /home/user/app/file.ts');
    expect(result).toBe('Error in [path]');
  });

  it('should remove Windows file paths', () => {
    const result = sanitizeLogMessage('Error at C:\\Users\\app\\file.ts');
    expect(result).toBe('Error at [path]');
  });

  it('should remove line numbers', () => {
    const result = sanitizeLogMessage('Error at file.ts:15:8');
    expect(result).not.toContain(':15:8');
  });

  it('should remove stack trace lines', () => {
    const message = 'Error occurred\n    at Function.test (/path/file.ts:10:5)\n    at Object.run';
    const result = sanitizeLogMessage(message);
    expect(result).not.toContain('at Function.test');
    expect(result).not.toContain('at Object.run');
  });

  it('should truncate long messages', () => {
    const longMessage = 'a'.repeat(600);
    const result = sanitizeLogMessage(longMessage);
    expect(result.length).toBeLessThanOrEqual(503); // 500 + '...'
    expect(result).toContain('...');
  });

  it('should use custom max length', () => {
    const message = 'a'.repeat(200);
    const result = sanitizeLogMessage(message, 100);
    expect(result.length).toBeLessThanOrEqual(103);
  });

  it('should trim whitespace', () => {
    const result = sanitizeLogMessage('  message with spaces  ');
    expect(result).toBe('message with spaces');
  });
});
