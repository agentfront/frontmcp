/**
 * Isolation Breakout Tests
 *
 * Tests for novel attack vectors targeting VM isolation boundaries.
 * These tests verify that dangerous ES2024+ APIs and advanced escape
 * techniques are properly blocked.
 *
 * Categories:
 * - A10: WeakRef/FinalizationRegistry escape attempts
 * - A13: ShadowRealm evaluation
 * - A15: Debugger statement injection
 * - ES2024+: Record/Tuple, Iterator helpers, Temporal API
 * - V8 Internals: Error.captureStackTrace, ArrayBuffer.transfer
 */

import {
  JSAstValidator,
  Presets,
  DisallowedIdentifierRule,
  NoGlobalAccessRule,
  createAgentScriptPreset,
} from '../index';

describe('Isolation Breakout Tests', () => {
  let strictValidator: JSAstValidator;
  let agentScriptValidator: JSAstValidator;

  beforeEach(() => {
    strictValidator = new JSAstValidator(Presets.strict());
    agentScriptValidator = new JSAstValidator(createAgentScriptPreset());
  });

  describe('A10: WeakRef/FinalizationRegistry Escape Attempts', () => {
    it('should block WeakRef constructor access', async () => {
      const code = `
        const target = {};
        const weakRef = new WeakRef(target);
        const obj = weakRef.deref();
      `;
      const result = await strictValidator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.message?.includes('WeakRef'))).toBe(true);
    });

    it('should block FinalizationRegistry for timing attacks', async () => {
      const code = `
        const registry = new FinalizationRegistry((heldValue) => {
          console.log('finalized:', heldValue);
        });
        registry.register({}, 'cleanup token');
      `;
      const result = await strictValidator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.message?.includes('FinalizationRegistry'))).toBe(true);
    });

    it('should block WeakRef constructor chain escape', async () => {
      const code = `
        const wr = new WeakRef({});
        const escape = wr.constructor.constructor('return process')();
      `;
      const result = await strictValidator.validate(code);
      expect(result.valid).toBe(false);
    });

    it('should block FinalizationRegistry callback escape', async () => {
      const code = `
        const registry = new FinalizationRegistry(function() {
          return this.constructor.constructor('return globalThis')();
        });
      `;
      const result = await strictValidator.validate(code);
      expect(result.valid).toBe(false);
    });
  });

  describe('A13: ShadowRealm Escape Attempts', () => {
    it('should block ShadowRealm constructor', async () => {
      const code = `
        const realm = new ShadowRealm();
        const result = realm.evaluate('globalThis.process');
      `;
      const result = await strictValidator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.message?.includes('ShadowRealm'))).toBe(true);
    });

    it('should block ShadowRealm importValue', async () => {
      const code = `
        const realm = new ShadowRealm();
        const getValue = await realm.importValue('./module.js', 'secret');
      `;
      const result = await strictValidator.validate(code);
      expect(result.valid).toBe(false);
    });
  });

  describe('A15: Debugger Statement Injection', () => {
    it('should allow debugger statements at AST level (blocked at runtime)', async () => {
      const code = `
        const secret = 'sensitive data';
        debugger;
      `;
      const result = await strictValidator.validate(code);
      // Note: STRICT mode doesn't specifically block debugger statements,
      // but the VM sandbox blocks debugger at runtime. This test documents
      // that the AST validation itself doesn't reject debugger statements.
      expect(result.valid).toBe(true);
    });

    it('should allow debugger in conditional expressions (runtime handled)', async () => {
      const code = `
        const debug = true;
        if (debug) debugger;
      `;
      const result = await strictValidator.validate(code);
      // Debugger statements are handled at runtime by the VM sandbox
      expect(result.valid).toBe(true);
    });
  });

  describe('ES2024+ Attack Surfaces', () => {
    describe('Record and Tuple (Future)', () => {
      // Note: These are stage 2 proposals, test syntax may not parse yet
      it.skip('should be prepared to block Record prototype access', async () => {
        // TODO: Implement when Record syntax becomes available (Stage 2+ proposal)
        // Test should validate:
        // const rec = #{ a: 1 };
        // rec.__proto__.constructor.constructor
      });
    });

    describe('Iterator Helpers', () => {
      it('should block Iterator constructor access', async () => {
        const code = `
          const iter = [1, 2, 3].values();
          const IteratorPrototype = Object.getPrototypeOf(Object.getPrototypeOf(iter));
        `;
        const result = await strictValidator.validate(code);
        expect(result.valid).toBe(false);
        // Object.getPrototypeOf should be blocked
      });

      it('should block iterator prototype poisoning', async () => {
        const code = `
          const arr = [1, 2, 3];
          arr[Symbol.iterator] = function*() {
            yield this.constructor.constructor('return process')();
          };
        `;
        const result = await strictValidator.validate(code);
        expect(result.valid).toBe(false);
        // Symbol should be blocked
      });
    });

    describe('Explicit Resource Management (using)', () => {
      // Note: using/await using is stage 3
      it('should block Symbol.dispose manipulation', async () => {
        const code = `
          const resource = {
            [Symbol.dispose]() {
              return this.constructor.constructor('return process')();
            }
          };
        `;
        const result = await strictValidator.validate(code);
        expect(result.valid).toBe(false);
        // Symbol should be blocked
      });
    });
  });

  describe('V8 Internal Attack Surfaces', () => {
    describe('Error.captureStackTrace', () => {
      it('should block Error.captureStackTrace manipulation', async () => {
        const code = `
          const obj = {};
          Error.captureStackTrace(obj);
          const frames = obj.stack;
        `;
        const result = await strictValidator.validate(code);
        expect(result.valid).toBe(false);
        // Error should be blocked in STRICT mode
      });

      it('should block Error.prepareStackTrace override', async () => {
        const code = `
          Error.prepareStackTrace = (error, structuredStackTrace) => {
            return structuredStackTrace.map(frame => frame.getFileName());
          };
        `;
        const result = await strictValidator.validate(code);
        expect(result.valid).toBe(false);
      });
    });

    describe('ArrayBuffer.transfer', () => {
      it('should block ArrayBuffer constructor', async () => {
        const code = `
          const buffer = new ArrayBuffer(1024);
          const view = new Uint8Array(buffer);
        `;
        const result = await strictValidator.validate(code);
        expect(result.valid).toBe(false);
        // ArrayBuffer should be blocked
      });

      it('should block ArrayBuffer.transfer escape', async () => {
        const code = `
          const buffer = new ArrayBuffer(1024);
          const transferred = buffer.transfer();
        `;
        const result = await strictValidator.validate(code);
        expect(result.valid).toBe(false);
      });
    });

    describe('SharedArrayBuffer', () => {
      it('should block SharedArrayBuffer for timing attacks', async () => {
        const code = `
          const sab = new SharedArrayBuffer(1024);
          const view = new Int32Array(sab);
          Atomics.wait(view, 0, 0);
        `;
        const result = await strictValidator.validate(code);
        expect(result.valid).toBe(false);
        // SharedArrayBuffer and Atomics should be blocked
      });
    });
  });

  describe('VM Context Escape Vectors', () => {
    describe('this binding escape', () => {
      it('should block non-strict mode this access', async () => {
        const code = `
          const context = (function() { return this; })();
          const keys = Object.keys(context);
        `;
        const result = await strictValidator.validate(code);
        expect(result.valid).toBe(false);
        // this access should be restricted
      });
    });

    describe('arguments.callee escape', () => {
      it('should block arguments.callee', async () => {
        const code = `
          function test() {
            return arguments.callee.caller;
          }
        `;
        const result = await strictValidator.validate(code);
        expect(result.valid).toBe(false);
        // arguments should be blocked in STRICT
      });
    });
  });

  describe('Timing and Side Channel Vectors', () => {
    describe('performance API', () => {
      it('should block performance.now() for timing attacks', async () => {
        const code = `
          const start = performance.now();
          // ... operation ...
          const end = performance.now();
          const duration = end - start;
        `;
        const result = await strictValidator.validate(code);
        expect(result.valid).toBe(false);
        // performance should be blocked
      });
    });

    describe('Date.now() timing', () => {
      it('should block Date in STRICT mode', async () => {
        const code = `
          const start = Date.now();
          const data = [1, 2, 3];
          const end = Date.now();
        `;
        const result = await strictValidator.validate(code);
        // STRICT mode blocks Date access entirely
        expect(result.valid).toBe(false);
        expect(result.issues.some((i) => i.message?.includes('Date'))).toBe(true);
      });

      it('should allow Date.now() in STANDARD preset (accepted risk)', async () => {
        // Use STANDARD preset which is less restrictive
        const standardValidator = new JSAstValidator(Presets.standard());
        const code = `
          const start = Date.now();
          const data = [1, 2, 3];
          const end = Date.now();
        `;
        const result = await standardValidator.validate(code);
        // ACCEPTED RISK: Date.now() allowed despite lower-resolution timing attack potential
        // Rationale: Required for common functionality; millisecond precision insufficient for most timing attacks
        expect(result.valid).toBe(true);
      });
    });
  });

  describe('Constructor Chain Escapes', () => {
    it('should block Object.constructor.constructor', async () => {
      const code = `
        const obj = {};
        const Func = obj.constructor.constructor;
        const escape = Func('return process')();
      `;
      const result = await strictValidator.validate(code);
      expect(result.valid).toBe(false);
    });

    it('should block Array.constructor.constructor', async () => {
      const code = `
        const arr = [];
        const Func = arr.constructor.constructor;
      `;
      const result = await strictValidator.validate(code);
      expect(result.valid).toBe(false);
    });

    it('should block String.constructor.constructor', async () => {
      const code = `
        const str = '';
        const Func = str.constructor.constructor;
      `;
      const result = await strictValidator.validate(code);
      expect(result.valid).toBe(false);
    });

    it('should block Number.constructor.constructor', async () => {
      const code = `
        const num = 0;
        const Func = num.constructor.constructor;
      `;
      const result = await strictValidator.validate(code);
      expect(result.valid).toBe(false);
    });

    it('should block Boolean.constructor.constructor', async () => {
      const code = `
        const bool = true;
        const Func = bool.constructor.constructor;
      `;
      const result = await strictValidator.validate(code);
      expect(result.valid).toBe(false);
    });

    it('should block Function.constructor via method reference', async () => {
      const code = `
        const fn = () => {};
        const Func = fn.constructor;
        const escape = new Func('return this')();
      `;
      const result = await strictValidator.validate(code);
      expect(result.valid).toBe(false);
    });
  });

  describe('Reserved Prefix Assignment Attacks', () => {
    it('should block __safe_callTool reassignment', async () => {
      // Note: Use agentScriptValidator because it includes ReservedPrefixRule
      const code = `
        __safe_callTool = () => 'pwned';
      `;
      const result = await agentScriptValidator.validate(code);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'RESERVED_PREFIX_ASSIGNMENT' || i.message?.includes('__safe_'))).toBe(
        true,
      );
    });

    it('should block __safe_callTool member assignment', async () => {
      // Note: Use agentScriptValidator because it includes ReservedPrefixRule
      const code = `
        this['__safe_callTool'] = () => 'pwned';
      `;
      const result = await agentScriptValidator.validate(code);
      expect(result.valid).toBe(false);
    });

    it('should block __ag_main reassignment', async () => {
      // Note: Use agentScriptValidator because it includes ReservedPrefixRule
      const code = `
        __ag_main = () => process;
      `;
      const result = await agentScriptValidator.validate(code);
      expect(result.valid).toBe(false);
    });

    it('should block __safe_ prefix declaration', async () => {
      // Note: Use agentScriptValidator because it includes ReservedPrefixRule
      const code = `
        const __safe_evil = () => {};
      `;
      const result = await agentScriptValidator.validate(code);
      expect(result.valid).toBe(false);
    });

    it('should block __ag_ prefix function declaration', async () => {
      // Note: __ag_main is explicitly allowed, but other __ag_ names should be blocked
      // Use agentScriptValidator because it includes ReservedPrefixRule
      const code = `
        function __ag_evil() {}
      `;
      const result = await agentScriptValidator.validate(code);
      expect(result.valid).toBe(false);
    });
  });

  describe('Prototype Manipulation', () => {
    it('should block Object.setPrototypeOf', async () => {
      const code = `
        const obj = {};
        Object.setPrototypeOf(obj, { evil: true });
      `;
      const result = await strictValidator.validate(code);
      expect(result.valid).toBe(false);
    });

    it('should block Reflect.setPrototypeOf', async () => {
      const code = `
        const obj = {};
        Reflect.setPrototypeOf(obj, { evil: true });
      `;
      const result = await strictValidator.validate(code);
      expect(result.valid).toBe(false);
    });

    it('should block __proto__ assignment', async () => {
      const code = `
        const obj = {};
        obj.__proto__ = { evil: true };
      `;
      const result = await strictValidator.validate(code);
      expect(result.valid).toBe(false);
    });

    it('should block Object.prototype pollution', async () => {
      const code = `
        Object.prototype.polluted = true;
      `;
      const result = await strictValidator.validate(code);
      expect(result.valid).toBe(false);
    });

    it('should block Array.prototype pollution', async () => {
      const code = `
        Array.prototype.polluted = true;
      `;
      const result = await strictValidator.validate(code);
      expect(result.valid).toBe(false);
    });
  });

  describe('Meta-Programming Abuse', () => {
    it('should block Proxy constructor', async () => {
      const code = `
        const proxy = new Proxy({}, {
          get(target, prop) {
            return process;
          }
        });
      `;
      const result = await strictValidator.validate(code);
      expect(result.valid).toBe(false);
    });

    it('should block Reflect API', async () => {
      const code = `
        const val = Reflect.get({}, 'constructor');
      `;
      const result = await strictValidator.validate(code);
      expect(result.valid).toBe(false);
    });

    it('should block Object.defineProperty', async () => {
      const code = `
        Object.defineProperty({}, 'evil', {
          get() { return process; }
        });
      `;
      const result = await strictValidator.validate(code);
      expect(result.valid).toBe(false);
    });

    it('should block Object.getOwnPropertyDescriptor', async () => {
      const code = `
        const desc = Object.getOwnPropertyDescriptor({}, 'constructor');
      `;
      const result = await strictValidator.validate(code);
      expect(result.valid).toBe(false);
    });
  });
});
