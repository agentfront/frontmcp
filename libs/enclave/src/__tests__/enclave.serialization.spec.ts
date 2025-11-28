/**
 * Serialization Security Tests
 *
 * Tests for JSON and object serialization security vulnerabilities.
 * These tests verify that prototype pollution and constructor chain
 * attacks via serialized data are properly prevented.
 *
 * Categories:
 * - C8: __proto__ key in JSON
 * - C9: constructor key in JSON
 * - C10: structuredClone bypass
 * - Tool return value sanitization
 * - Circular reference handling
 */

import { Enclave } from '../enclave';
import { sanitizeValue, canSanitize } from '../value-sanitizer';

describe('Serialization Security Tests', () => {
  describe('C8: __proto__ Key in JSON', () => {
    it('should safely parse JSON with __proto__ key', async () => {
      const enclave = new Enclave({
        toolHandler: async () => ({
          __proto__: { polluted: true },
          data: 'safe',
        }),
      });

      const code = `
        const result = await callTool('test', {});
        return result;
      `;

      const result = await enclave.run(code);
      // The result should be sanitized
      if (result.success) {
        const value = result.value as Record<string, unknown>;
        // __proto__ should be stripped
        expect(value['__proto__']).toBeUndefined();
        expect(value['data']).toBe('safe');
      }

      // Verify host environment is not polluted
      const testObj: Record<string, unknown> = {};
      expect(testObj['polluted']).toBeUndefined();

      enclave.dispose();
    });

    it('should not allow JSON.parse prototype pollution', async () => {
      const enclave = new Enclave({
        toolHandler: async () => {
          return JSON.parse('{"__proto__": {"isAdmin": true}}');
        },
      });

      const code = `
        const malicious = await callTool('test', {});
        const clean = {};
        return clean.isAdmin;
      `;

      const result = await enclave.run(code);
      // Should not inherit isAdmin
      if (result.success) {
        expect(result.value).toBeUndefined();
      }

      // Verify host is not polluted
      expect(({} as any).isAdmin).toBeUndefined();

      enclave.dispose();
    });

    it('should strip nested __proto__ keys from returned objects', async () => {
      const enclave = new Enclave({
        toolHandler: async () => ({
          level1: {
            __proto__: { nested: 'pollution' },
            data: 'nested-safe',
          },
        }),
      });

      const code = `
        const result = await callTool('test', {});
        return result.level1;
      `;

      const result = await enclave.run(code);
      if (result.success) {
        const value = result.value as Record<string, unknown>;
        expect(value['__proto__']).toBeUndefined();
        expect(value['data']).toBe('nested-safe');
      }

      enclave.dispose();
    });
  });

  describe('C9: constructor Key in JSON', () => {
    it('should strip constructor key from tool return values', async () => {
      const enclave = new Enclave({
        toolHandler: async () => ({
          constructor: function EvilConstructor() {},
          data: 'safe',
        }),
      });

      const code = `
        const result = await callTool('test', {});
        return typeof result.constructor;
      `;

      const result = await enclave.run(code);
      // constructor should be stripped or be undefined
      if (result.success) {
        expect(result.value).toBe('undefined');
      }

      enclave.dispose();
    });

    it('should prevent constructor chain access from tool results', async () => {
      const enclave = new Enclave({
        toolHandler: async () => ({
          obj: {
            constructor: {
              constructor: function () {
                return process;
              },
            },
          },
        }),
      });

      const code = `
        const result = await callTool('test', {});
        return result.obj;
      `;

      const result = await enclave.run(code);
      // Nested constructor should be stripped
      if (result.success) {
        const value = result.value as Record<string, unknown>;
        expect(value.constructor).toBeUndefined();
      }

      enclave.dispose();
    });
  });

  describe('Value Sanitizer Unit Tests', () => {
    it('should reject functions in return values', () => {
      expect(() => sanitizeValue(() => {})).toThrow('function');
      expect(() => sanitizeValue({ fn: () => {} })).toThrow('function');
    });

    it('should reject symbols in return values', () => {
      expect(() => sanitizeValue(Symbol('test'))).toThrow('symbol');
      expect(() => sanitizeValue({ s: Symbol('test') })).toThrow('symbol');
    });

    it('should strip __proto__ keys', () => {
      const malicious = { __proto__: { polluted: true }, safe: 'data' };
      const sanitized = sanitizeValue(malicious) as Record<string, unknown>;
      expect(sanitized['__proto__']).toBeUndefined();
      expect(sanitized['safe']).toBe('data');
    });

    it('should strip constructor keys', () => {
      const malicious = { constructor: () => {}, safe: 'data' };
      const sanitized = sanitizeValue(malicious) as Record<string, unknown>;
      expect(sanitized['constructor']).toBeUndefined();
      expect(sanitized['safe']).toBe('data');
    });

    it('should create null-prototype objects', () => {
      const sanitized = sanitizeValue({ a: 1 });
      expect(Object.getPrototypeOf(sanitized)).toBe(null);
    });

    it('should enforce max depth', () => {
      let deep: unknown = { value: 1 };
      for (let i = 0; i < 50; i++) {
        deep = { nested: deep };
      }
      expect(() => sanitizeValue(deep, { maxDepth: 10 })).toThrow('maximum depth');
    });

    it('should enforce max properties', () => {
      const huge: Record<string, number> = {};
      for (let i = 0; i < 100; i++) {
        huge[`key${i}`] = i;
      }
      expect(() => sanitizeValue(huge, { maxProperties: 50 })).toThrow('maximum properties');
    });

    it('should handle Date objects', () => {
      const date = new Date('2024-01-01');
      const sanitized = sanitizeValue(date);
      expect(sanitized instanceof Date).toBe(true);
    });

    it('should handle Error objects safely', () => {
      const error = new Error('test error');
      const sanitized = sanitizeValue(error) as { name: string; message: string };
      expect(sanitized.name).toBe('Error');
      expect(sanitized.message).toBe('test error');
      // Stack trace should NOT be included
      expect((sanitized as any).stack).toBeUndefined();
    });

    it('should handle arrays', () => {
      const arr = [1, 'two', { three: 3 }];
      const sanitized = sanitizeValue(arr) as unknown[];
      expect(Array.isArray(sanitized)).toBe(true);
      expect(sanitized.length).toBe(3);
    });

    it('should handle Map objects', () => {
      const map = new Map([['key', 'value']]);
      const sanitized = sanitizeValue(map) as Record<string, unknown>;
      expect(sanitized['key']).toBe('value');
      expect(Object.getPrototypeOf(sanitized)).toBe(null);
    });

    it('should handle Set objects', () => {
      const set = new Set([1, 2, 3]);
      const sanitized = sanitizeValue(set) as number[];
      expect(Array.isArray(sanitized)).toBe(true);
      expect(sanitized).toEqual([1, 2, 3]);
    });

    it('should handle circular references gracefully', () => {
      const obj: Record<string, unknown> = { a: 1 };
      obj['self'] = obj;
      // Should not throw infinite loop
      // The visited WeakSet will catch this and return '[Circular]' marker
      const sanitized = sanitizeValue(obj) as Record<string, unknown>;
      expect(sanitized['a']).toBe(1);
      expect(sanitized['self']).toBe('[Circular]');
    });

    it('canSanitize should return false for functions', () => {
      expect(canSanitize(() => {})).toBe(false);
      expect(canSanitize({ fn: () => {} })).toBe(false);
    });

    it('canSanitize should return true for safe values', () => {
      expect(canSanitize(42)).toBe(true);
      expect(canSanitize('string')).toBe(true);
      expect(canSanitize({ a: 1 })).toBe(true);
      expect(canSanitize([1, 2, 3])).toBe(true);
    });
  });

  describe('Tool Handler Return Value Security', () => {
    it('should reject tool handler returning function', async () => {
      const enclave = new Enclave({
        toolHandler: async () => () => 'pwned',
      });

      const code = `
        const result = await callTool('test', {});
        return result;
      `;

      const result = await enclave.run(code);
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('function');

      enclave.dispose();
    });

    it('should reject tool handler returning nested function', async () => {
      const enclave = new Enclave({
        toolHandler: async () => ({
          callback: () => 'pwned',
        }),
      });

      const code = `
        const result = await callTool('test', {});
        return result;
      `;

      const result = await enclave.run(code);
      expect(result.success).toBe(false);

      enclave.dispose();
    });

    it('should handle deeply nested safe data', async () => {
      const deepData = {
        level1: {
          level2: {
            level3: {
              level4: {
                value: 'deep-but-safe',
              },
            },
          },
        },
      };

      const enclave = new Enclave({
        toolHandler: async () => deepData,
      });

      const code = `
        const result = await callTool('test', {});
        return result.level1.level2.level3.level4.value;
      `;

      const result = await enclave.run(code);
      expect(result.success).toBe(true);
      expect(result.value).toBe('deep-but-safe');

      enclave.dispose();
    });

    it('should reject excessively deep data', async () => {
      let deep: any = { value: 'bottom' };
      for (let i = 0; i < 30; i++) {
        deep = { nested: deep };
      }

      const enclave = new Enclave({
        toolHandler: async () => deep,
      });

      const code = `
        const result = await callTool('test', {});
        return result;
      `;

      const result = await enclave.run(code);
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('depth');

      enclave.dispose();
    });
  });

  describe('JSON Serialization Edge Cases', () => {
    it('should handle BigInt serialization', async () => {
      const enclave = new Enclave({
        toolHandler: async () => ({
          big: 123n, // BigInt
        }),
      });

      const code = `
        const result = await callTool('test', {});
        return typeof result.big;
      `;

      const result = await enclave.run(code);
      // BigInt should be preserved or converted
      if (result.success) {
        expect(['bigint', 'string']).toContain(result.value);
      }

      enclave.dispose();
    });

    it('should handle undefined values in objects', async () => {
      const enclave = new Enclave({
        toolHandler: async () => ({
          defined: 'yes',
          undef: undefined,
        }),
      });

      const code = `
        const result = await callTool('test', {});
        return result;
      `;

      const result = await enclave.run(code);
      expect(result.success).toBe(true);

      enclave.dispose();
    });

    it('should handle null values', async () => {
      const enclave = new Enclave({
        toolHandler: async () => ({
          nullValue: null,
        }),
      });

      const code = `
        const result = await callTool('test', {});
        return result.nullValue;
      `;

      const result = await enclave.run(code);
      expect(result.success).toBe(true);
      expect(result.value).toBe(null);

      enclave.dispose();
    });

    it('should handle RegExp conversion', async () => {
      const enclave = new Enclave({
        toolHandler: async () => ({
          pattern: /test/gi,
        }),
      });

      const code = `
        const result = await callTool('test', {});
        return typeof result.pattern;
      `;

      const result = await enclave.run(code);
      // RegExp should be converted to string
      if (result.success) {
        expect(result.value).toBe('string');
      }

      enclave.dispose();
    });
  });

  describe('Tool Result Attacks', () => {
    it('should block getter execution leaking Function on tool results', async () => {
      // Create an object with a getter that tries to return Function
      const evilObj = {};
      Object.defineProperty(evilObj, 'data', {
        get() {
          return Function;
        },
        enumerable: true,
      });

      const enclave = new Enclave({
        toolHandler: async () => evilObj,
      });

      const code = `
        const r = await callTool('t', {});
        return typeof r.data;
      `;

      const result = await enclave.run(code);

      // Getter should be stripped during sanitization
      // so data should be undefined or not a function
      if (result.success) {
        expect(result.value).not.toBe('function');
      }

      enclave.dispose();
    });

    it('should strip Symbol properties from tool results', async () => {
      const enclave = new Enclave({
        toolHandler: async () => ({
          [Symbol.toStringTag]: 'Promise',
          normalProp: 'value',
        }),
      });

      const code = `
        const r = await callTool('t', {});
        return Object.keys(r);
      `;

      const result = await enclave.run(code);

      // Symbol properties should be stripped
      if (result.success) {
        const keys = result.value as string[];
        expect(keys).not.toContain(Symbol.toStringTag.toString());
      }

      enclave.dispose();
    });

    it('should enforce maxProperties limit on tool results', async () => {
      const enclave = new Enclave({
        toolHandler: async () => {
          const o: Record<string, number> = {};
          for (let i = 0; i < 20000; i++) {
            o[`p${i}`] = i;
          }
          return o;
        },
      });

      const code = `return await callTool('t', {});`;

      const result = await enclave.run(code);

      // Should fail due to maxProperties limit
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('maximum properties');

      enclave.dispose();
    });

    it('should handle circular references in tool results safely', async () => {
      const enclave = new Enclave({
        toolHandler: async () => {
          const o: Record<string, unknown> = { data: 'test' };
          o['self'] = o;
          return o;
        },
      });

      const code = `return await callTool('t', {});`;

      const result = await enclave.run(code);

      // Should handle circular reference safely
      if (result.success) {
        const value = result.value as Record<string, unknown>;
        expect(value['data']).toBe('test');
        // Circular ref should be replaced with marker
        expect(value['self']).toBe('[Circular]');
      }

      enclave.dispose();
    });

    it('should prevent spread operator constructor access on tool results', async () => {
      const enclave = new Enclave({
        toolHandler: async () => ({ data: 1 }),
      });

      const code = `
        const r = await callTool('t', {});
        const s = { ...r };
        return typeof s.constructor;
      `;

      const result = await enclave.run(code);

      // Should fail - constructor access blocked
      expect(result.success).toBe(false);

      enclave.dispose();
    });
  });

  describe('Prototype Pollution via Merge Operations', () => {
    it('should not allow Object.assign pollution from tool results', async () => {
      const enclave = new Enclave({
        toolHandler: async () => ({
          __proto__: { isAdmin: true },
          data: 'test',
        }),
      });

      const code = `
        const malicious = await callTool('test', {});
        const target = {};
        // Try to merge - should not pollute
        for (const key of ['data', '__proto__']) {
          if (malicious[key] !== undefined) {
            target[key] = malicious[key];
          }
        }
        const check = {};
        return check.isAdmin;
      `;

      const result = await enclave.run(code);
      if (result.success) {
        expect(result.value).toBeUndefined();
      }

      enclave.dispose();
    });
  });
});
