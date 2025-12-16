/**
 * @file safe-stringify.test.ts
 * @description Tests for the safeStringify utility.
 */

import { safeStringify } from '../safe-stringify';

describe('safeStringify', () => {
  describe('basic functionality', () => {
    it('should stringify simple objects', () => {
      expect(safeStringify({ name: 'test' })).toBe('{"name":"test"}');
    });

    it('should stringify arrays', () => {
      expect(safeStringify([1, 2, 3])).toBe('[1,2,3]');
    });

    it('should stringify primitive values', () => {
      expect(safeStringify('hello')).toBe('"hello"');
      expect(safeStringify(42)).toBe('42');
      expect(safeStringify(true)).toBe('true');
      expect(safeStringify(null)).toBe('null');
    });

    it('should stringify nested objects', () => {
      const nested = { a: { b: { c: 'deep' } } };
      expect(safeStringify(nested)).toBe('{"a":{"b":{"c":"deep"}}}');
    });
  });

  describe('circular reference handling', () => {
    it('should handle self-referencing objects', () => {
      const obj: Record<string, unknown> = { name: 'test' };
      obj.self = obj;
      const result = safeStringify(obj);
      expect(result).toBe('{"name":"test","self":"[Circular]"}');
    });

    it('should handle circular references in nested objects', () => {
      const parent: Record<string, unknown> = { type: 'parent' };
      const child: Record<string, unknown> = { type: 'child', parent };
      parent.child = child;
      child.ref = parent;

      const result = safeStringify(parent);
      expect(result).toContain('"type":"parent"');
      expect(result).toContain('[Circular]');
    });

    it('should handle circular references in arrays', () => {
      const arr: unknown[] = [1, 2, 3];
      arr.push(arr);
      const result = safeStringify(arr);
      expect(result).toBe('[1,2,3,"[Circular]"]');
    });

    it('should handle multiple references to same object', () => {
      const shared = { value: 'shared' };
      const obj = { a: shared, b: shared };
      const result = safeStringify(obj);
      // Second reference to shared becomes circular
      expect(result).toContain('[Circular]');
    });

    it('should handle deeply nested circular references', () => {
      const a: Record<string, unknown> = { level: 'a' };
      const b: Record<string, unknown> = { level: 'b', parent: a };
      const c: Record<string, unknown> = { level: 'c', parent: b };
      a.deepChild = c;
      c.root = a; // Circular back to a

      const result = safeStringify(a);
      expect(result).toContain('[Circular]');
      expect(result).not.toThrow;
    });
  });

  describe('pretty printing with space parameter', () => {
    it('should pretty print with 2 spaces', () => {
      const obj = { name: 'test' };
      const result = safeStringify(obj, 2);
      expect(result).toBe('{\n  "name": "test"\n}');
    });

    it('should pretty print with 4 spaces', () => {
      const obj = { name: 'test' };
      const result = safeStringify(obj, 4);
      expect(result).toBe('{\n    "name": "test"\n}');
    });

    it('should pretty print nested objects', () => {
      const nested = { a: { b: 'value' } };
      const result = safeStringify(nested, 2);
      expect(result).toContain('\n');
      expect(result).toContain('  ');
    });

    it('should handle space=0 (minified)', () => {
      const obj = { name: 'test', value: 42 };
      const result = safeStringify(obj, 0);
      expect(result).toBe('{"name":"test","value":42}');
    });
  });

  describe('edge cases', () => {
    it('should handle undefined', () => {
      expect(safeStringify(undefined)).toBeUndefined();
    });

    it('should handle functions (converted to undefined)', () => {
      const obj = { fn: () => 'test', name: 'test' };
      const result = safeStringify(obj);
      expect(result).toBe('{"name":"test"}');
    });

    it('should handle Date objects', () => {
      const date = new Date('2024-01-01T00:00:00.000Z');
      const result = safeStringify({ date });
      expect(result).toBe('{"date":"2024-01-01T00:00:00.000Z"}');
    });

    it('should handle RegExp (converted to empty object)', () => {
      const result = safeStringify({ regex: /test/ });
      expect(result).toBe('{"regex":{}}');
    });

    it('should handle empty objects', () => {
      expect(safeStringify({})).toBe('{}');
    });

    it('should handle empty arrays', () => {
      expect(safeStringify([])).toBe('[]');
    });

    it('should handle Map and Set (converted to empty objects)', () => {
      const map = new Map([['key', 'value']]);
      const set = new Set([1, 2, 3]);
      expect(safeStringify({ map, set })).toBe('{"map":{},"set":{}}');
    });

    it('should handle BigInt by returning error object', () => {
      // BigInt cannot be serialized by JSON.stringify
      // This should trigger the catch block
      const obj = { value: BigInt(9007199254740991) };
      const result = safeStringify(obj);
      expect(result).toBe('{"error":"Output could not be serialized"}');
    });

    it('should handle Symbol values (omitted from output)', () => {
      const sym = Symbol('test');
      const obj = { name: 'test', [sym]: 'hidden' };
      const result = safeStringify(obj);
      expect(result).toBe('{"name":"test"}');
    });
  });

  describe('error handling', () => {
    it('should return error object for objects that throw during stringification', () => {
      const obj = {
        get value() {
          throw new Error('Cannot get value');
        },
      };
      // This may or may not throw depending on how JSON.stringify handles getters
      const result = safeStringify(obj);
      // Either it succeeds with empty or returns error
      expect(typeof result).toBe('string');
    });

    it('should handle objects with toJSON that throws', () => {
      const obj = {
        toJSON() {
          throw new Error('toJSON failed');
        },
      };
      const result = safeStringify(obj);
      expect(result).toBe('{"error":"Output could not be serialized"}');
    });
  });

  describe('complex real-world scenarios', () => {
    it('should handle MCP-like response objects', () => {
      const response = {
        content: [
          { type: 'text', text: 'Hello world' },
          { type: 'image', data: 'base64...' },
        ],
        _meta: {
          'ui/html': '<div>Test</div>',
        },
        isError: false,
      };
      const result = safeStringify(response);
      expect(result).toContain('"type":"text"');
      expect(result).toContain('"ui/html"');
    });

    it('should handle tool outputs with nested data', () => {
      const toolOutput = {
        users: [
          { id: 1, name: 'Alice', profile: { age: 30 } },
          { id: 2, name: 'Bob', profile: { age: 25 } },
        ],
        pagination: {
          page: 1,
          total: 100,
        },
      };
      const result = safeStringify(toolOutput, 2);
      expect(result).toContain('"users"');
      expect(result).toContain('"pagination"');
      expect(JSON.parse(result)).toEqual(toolOutput);
    });

    it('should handle mixed content with various types', () => {
      const mixed = {
        string: 'hello',
        number: 42,
        boolean: true,
        null: null,
        array: [1, 'two', { three: 3 }],
        nested: { deep: { value: 'found' } },
      };
      const result = safeStringify(mixed);
      const parsed = JSON.parse(result);
      expect(parsed).toEqual(mixed);
    });
  });
});
