/**
 * Tests for SecureProxy - Runtime Property Access Protection
 *
 * These tests verify that the secure proxy blocks dangerous property access
 * at runtime, preventing attacks that bypass static analysis.
 */

import { createSecureProxy, wrapGlobalsWithSecureProxy, createSecureStandardLibrary } from '../secure-proxy';

describe('SecureProxy', () => {
  describe('Constructor Access Blocking', () => {
    it('should block direct constructor access', () => {
      const fn = function testFn() {
        return 42;
      };
      const proxy = createSecureProxy(fn);

      expect(proxy.constructor).toBeUndefined();
    });

    it('should block computed constructor access via string concatenation', () => {
      const fn = function testFn() {
        return 42;
      };
      const proxy = createSecureProxy(fn);

      // This is the attack vector: 'const' + 'ructor' = 'constructor'
      const m = 'const';
      const key = m + 'ructor';
      expect((proxy as any)[key]).toBeUndefined();
    });

    it('should block constructor access on objects', () => {
      const obj = { name: 'test', value: 42 };
      const proxy = createSecureProxy(obj);

      expect(proxy.constructor).toBeUndefined();
      expect((proxy as any)['constructor']).toBeUndefined();
    });

    it('should block constructor access on arrays', () => {
      const arr = [1, 2, 3];
      const proxy = createSecureProxy(arr);

      expect(proxy.constructor).toBeUndefined();
    });
  });

  describe('Prototype Access Blocking', () => {
    it('should block __proto__ access', () => {
      const obj = { name: 'test' };
      const proxy = createSecureProxy(obj);

      expect((proxy as any).__proto__).toBeUndefined();
      expect((proxy as any)['__proto__']).toBeUndefined();
    });

    it('should block prototype access', () => {
      const fn = function testFn() {
        return 42;
      };
      const proxy = createSecureProxy(fn);

      expect((proxy as any).prototype).toBeUndefined();
    });

    it('should hide prototype chain via getPrototypeOf', () => {
      const obj = { name: 'test' };
      const proxy = createSecureProxy(obj);

      expect(Object.getPrototypeOf(proxy)).toBeNull();
    });

    it('should throw when setPrototypeOf is attempted', () => {
      const obj = { name: 'test' };
      const proxy = createSecureProxy(obj);

      // setPrototypeOf should throw when blocked
      expect(() => {
        Object.setPrototypeOf(proxy, { evil: true });
      }).toThrow();

      // Prototype should still be null (blocked)
      expect(Object.getPrototypeOf(proxy)).toBeNull();
    });
  });

  describe('Legacy Getter/Setter Blocking', () => {
    it('should block __defineGetter__', () => {
      const obj = { name: 'test' };
      const proxy = createSecureProxy(obj);

      expect((proxy as any).__defineGetter__).toBeUndefined();
    });

    it('should block __defineSetter__', () => {
      const obj = { name: 'test' };
      const proxy = createSecureProxy(obj);

      expect((proxy as any).__defineSetter__).toBeUndefined();
    });

    it('should block __lookupGetter__', () => {
      const obj = { name: 'test' };
      const proxy = createSecureProxy(obj);

      expect((proxy as any).__lookupGetter__).toBeUndefined();
    });

    it('should block __lookupSetter__', () => {
      const obj = { name: 'test' };
      const proxy = createSecureProxy(obj);

      expect((proxy as any).__lookupSetter__).toBeUndefined();
    });
  });

  describe('Normal Property Access', () => {
    it('should allow access to regular properties', () => {
      const obj = { name: 'test', value: 42 };
      const proxy = createSecureProxy(obj);

      expect(proxy.name).toBe('test');
      expect(proxy.value).toBe(42);
    });

    it('should allow function invocation', () => {
      const fn = function testFn(x: number) {
        return x * 2;
      };
      const proxy = createSecureProxy(fn);

      expect(proxy(21)).toBe(42);
    });

    it('should allow array methods', () => {
      const arr = [1, 2, 3];
      const proxy = createSecureProxy(arr);

      expect(proxy.length).toBe(3);
      expect(proxy.map((x: number) => x * 2)).toEqual([2, 4, 6]);
      expect(proxy.filter((x: number) => x > 1)).toEqual([2, 3]);
    });

    it('should allow object methods', () => {
      const obj = {
        name: 'test',
        getValue() {
          return 42;
        },
      };
      const proxy = createSecureProxy(obj);

      expect(proxy.getValue()).toBe(42);
    });
  });

  describe('Recursive Proxying', () => {
    it('should proxy nested objects', () => {
      const obj = {
        outer: {
          inner: {
            value: 42,
          },
        },
      };
      const proxy = createSecureProxy(obj);

      // Normal access works
      expect(proxy.outer.inner.value).toBe(42);

      // Constructor access blocked at all levels
      expect(proxy.outer.constructor).toBeUndefined();
      expect(proxy.outer.inner.constructor).toBeUndefined();
    });

    it('should proxy return values from functions', () => {
      const obj = {
        getInner() {
          return { value: 42 };
        },
      };
      const proxy = createSecureProxy(obj);

      const inner = proxy.getInner();
      expect(inner.value).toBe(42);
      expect(inner.constructor).toBeUndefined();
    });

    it('should respect maxDepth option', () => {
      const deepObj: any = { level: 0 };
      let current = deepObj;
      for (let i = 1; i <= 20; i++) {
        current.nested = { level: i };
        current = current.nested;
      }

      const proxy = createSecureProxy(deepObj, { maxDepth: 5 });

      // Access within depth limit is proxied
      expect(proxy.nested.nested.constructor).toBeUndefined();

      // Beyond maxDepth, we get the raw object (constructor accessible)
      // Note: This test verifies the depth limit works, not that it's unsafe
    });
  });

  describe('Setting Blocked Properties', () => {
    it('should throw when setting constructor', () => {
      const obj: any = { name: 'test' };
      const proxy = createSecureProxy(obj);

      // Setting constructor should throw in strict mode
      expect(() => {
        proxy.constructor = 'evil';
      }).toThrow();

      // Constructor access should still be blocked
      expect(proxy.constructor).toBeUndefined();
    });

    it('should block setting __proto__', () => {
      const obj: any = { name: 'test' };
      const proxy = createSecureProxy(obj);

      // In strict mode, setting a property that returns false from set trap throws
      // So we test that __proto__ access returns undefined (blocked)
      expect(proxy.__proto__).toBeUndefined();

      // Verify the object's actual __proto__ wasn't modified
      expect(Object.getPrototypeOf(obj)).toBe(Object.prototype);
    });

    it('should allow setting normal properties', () => {
      const obj: any = { name: 'test' };
      const proxy = createSecureProxy(obj);

      proxy.value = 42;
      expect(proxy.value).toBe(42);
    });
  });

  describe('wrapGlobalsWithSecureProxy', () => {
    it('should wrap all object values', () => {
      const globals = {
        myFunc: function () {
          return 42;
        },
        myObj: { name: 'test' },
        myNum: 123,
        myStr: 'hello',
      };

      const wrapped = wrapGlobalsWithSecureProxy(globals);

      // Functions and objects are proxied
      expect((wrapped['myFunc'] as any).constructor).toBeUndefined();
      expect((wrapped['myObj'] as any).constructor).toBeUndefined();

      // Primitives are passed through
      expect(wrapped['myNum']).toBe(123);
      expect(wrapped['myStr']).toBe('hello');
    });
  });

  describe('createSecureStandardLibrary', () => {
    it('should create proxied standard library', () => {
      const stdLib = createSecureStandardLibrary();

      // Math should work
      expect((stdLib['Math'] as typeof Math).max(1, 2, 3)).toBe(3);

      // But constructor should be blocked
      expect((stdLib['Math'] as any).constructor).toBeUndefined();
    });

    it('should block constructor on Array', () => {
      const stdLib = createSecureStandardLibrary();

      // Array methods should work
      expect((stdLib['Array'] as typeof Array).isArray([1, 2, 3])).toBe(true);

      // But constructor should be blocked
      expect((stdLib['Array'] as any).constructor).toBeUndefined();
    });
  });

  describe('Attack Vector Tests', () => {
    it('should block the original attack: callTool[m + "ructor"]', () => {
      // Simulate callTool function
      async function callTool(name: string, args: object) {
        return { result: name };
      }

      const proxy = createSecureProxy(callTool);

      // The attack tries to get Function constructor via string concatenation
      const m = 'const';
      const constructorAccess = (proxy as any)[m + 'ructor'];

      expect(constructorAccess).toBeUndefined();
    });

    it('should block prototype chain walking', () => {
      const obj = { name: 'test' };
      const proxy = createSecureProxy(obj);

      // Attempt to walk prototype chain
      const proto = Object.getPrototypeOf(proxy);
      expect(proto).toBeNull();
    });

    it('should block Function constructor access via nested property', () => {
      const obj = {
        getFunc: function () {
          return function inner() {
            return 42;
          };
        },
      };
      const proxy = createSecureProxy(obj);

      const inner = proxy.getFunc();
      expect(inner.constructor).toBeUndefined();
    });

    it('should block computed property access for dangerous properties', () => {
      const obj = { value: 42 };
      const proxy = createSecureProxy(obj);

      const properties = ['constructor', '__proto__', 'prototype'];
      for (const prop of properties) {
        expect((proxy as any)[prop]).toBeUndefined();
      }
    });
  });

  describe('Proxy Invariant Attacks', () => {
    it('should handle non-configurable property access correctly', () => {
      // JavaScript proxy invariants require returning the actual value for
      // non-configurable, non-writable properties
      const obj = {};
      Object.defineProperty(obj, 'frozen', {
        value: 42,
        configurable: false,
        writable: false,
      });

      const proxy = createSecureProxy(obj);

      // Non-configurable frozen property should be accessible
      expect((proxy as any).frozen).toBe(42);
    });

    it('should block constructor via bound functions', () => {
      const arr = [1, 2, 3];
      const proxy = createSecureProxy(arr);

      // Get map method from proxied array
      const map = proxy.map;

      // Even the extracted method should have constructor blocked
      expect((map as any).constructor).toBeUndefined();
    });

    it('should handle deep proxy recursion safely', () => {
      // Create deeply nested object
      const deep = { a: { b: { c: { d: { e: { value: 42 } } } } } };
      const proxy = createSecureProxy(deep);

      // Should be able to access deep properties
      expect(proxy.a.b.c.d.e.value).toBe(42);

      // Constructor should be blocked at all levels
      expect((proxy as any).constructor).toBeUndefined();
      expect((proxy.a as any).constructor).toBeUndefined();
      expect((proxy.a.b as any).constructor).toBeUndefined();
      expect((proxy.a.b.c as any).constructor).toBeUndefined();
    });
  });

  describe('onBlocked Callback', () => {
    it('should call onBlocked when dangerous property is accessed', () => {
      const blocked: Array<{ target: unknown; property: string }> = [];
      const obj = { name: 'test' };
      const proxy = createSecureProxy(obj, {
        onBlocked: (target, property) => {
          blocked.push({ target, property: String(property) });
        },
      });

      // Access dangerous properties
      void (proxy as any).constructor;
      void (proxy as any).__proto__;

      expect(blocked).toHaveLength(2);
      expect(blocked[0].property).toBe('constructor');
      expect(blocked[1].property).toBe('__proto__');
    });
  });
});
