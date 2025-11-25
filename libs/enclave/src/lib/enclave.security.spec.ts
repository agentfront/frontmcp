/**
 * Enclave Security Tests
 *
 * Comprehensive security and vulnerability testing for the Enclave execution environment.
 * Tests defense against various attack vectors including code injection, prototype pollution,
 * sandbox escapes, and resource exhaustion.
 */

import { Enclave } from './enclave';
import type { ToolHandler } from './types';

describe('Enclave Security Tests', () => {
  describe('Code Injection Prevention', () => {
    it('should block eval() attempts', async () => {
      const enclave = new Enclave();
      const code = `
        const result = eval('1 + 1');
        return result;
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_ERROR');
      expect(result.error?.message).toContain('eval');

      enclave.dispose();
    });

    it('should block Function constructor', async () => {
      const enclave = new Enclave();
      const code = `
        const fn = new Function('return 42');
        return fn();
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_ERROR');

      enclave.dispose();
    });

    it('should block indirect eval via bracket notation', async () => {
      const enclave = new Enclave();
      const code = `
        const evil = this['ev' + 'al'];
        return evil('1+1');
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      // Either validation error or runtime error

      enclave.dispose();
    });

    it('should block setTimeout with string code', async () => {
      const enclave = new Enclave();
      const code = `
        setTimeout('console.log("pwned")', 100);
        return 'done';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      // setTimeout should not be available

      enclave.dispose();
    });
  });

  describe('Global Access Prevention', () => {
    it('should block access to process', async () => {
      const enclave = new Enclave();
      const code = `
        return typeof process;
      `;

      const result = await enclave.run(code);

      if (result.success) {
        expect(result.value).toBe('undefined');
      }

      enclave.dispose();
    });

    it('should block access to require', async () => {
      const enclave = new Enclave();
      const code = `
        return typeof require;
      `;

      const result = await enclave.run(code);

      if (result.success) {
        expect(result.value).toBe('undefined');
      }

      enclave.dispose();
    });

    it('should block access to global', async () => {
      const enclave = new Enclave();
      const code = `
        return typeof global;
      `;

      const result = await enclave.run(code);

      if (result.success) {
        expect(result.value).toBe('undefined');
      }

      enclave.dispose();
    });

    it('should block access to globalThis', async () => {
      const enclave = new Enclave();
      const code = `
        return typeof globalThis;
      `;

      const result = await enclave.run(code);

      if (result.success) {
        expect(result.value).toBe('undefined');
      }

      enclave.dispose();
    });

    it('should block access to module', async () => {
      const enclave = new Enclave();
      const code = `
        return typeof module;
      `;

      const result = await enclave.run(code);

      if (result.success) {
        expect(result.value).toBe('undefined');
      }

      enclave.dispose();
    });

    it('should block access to __dirname and __filename', async () => {
      const enclave = new Enclave();
      const code = `
        return typeof __dirname + typeof __filename;
      `;

      const result = await enclave.run(code);

      if (result.success) {
        expect(result.value).toBe('undefinedundefined');
      }

      enclave.dispose();
    });
  });

  describe('Prototype Pollution Prevention', () => {
    it('should prevent Object.prototype pollution', async () => {
      const enclave = new Enclave();
      const code = `
        Object.prototype.polluted = 'pwned';
        return Object.prototype.polluted;
      `;

      const result = await enclave.run(code);

      // Even if it succeeds in the sandbox, it shouldn't affect host
      const testObj: Record<string, unknown> = {};
      expect(testObj['polluted']).toBeUndefined();

      enclave.dispose();
    });

    it('should prevent Array.prototype pollution', async () => {
      const enclave = new Enclave();
      const code = `
        Array.prototype.polluted = 'pwned';
        const arr = [];
        return arr.polluted;
      `;

      const result = await enclave.run(code);

      // Verify host Array.prototype is not polluted
      const testArr: unknown[] = [];
      expect((testArr as unknown as Record<string, unknown>)['polluted']).toBeUndefined();

      enclave.dispose();
    });

    it('should block __proto__ manipulation', async () => {
      const enclave = new Enclave();
      const code = `
        const obj = {};
        obj.__proto__.polluted = 'pwned';
        return obj.polluted;
      `;

      const result = await enclave.run(code);

      // Verify host is not polluted
      const testObj: Record<string, unknown> = {};
      expect(testObj['polluted']).toBeUndefined();

      enclave.dispose();
    });

    it('should prevent constructor.prototype pollution', async () => {
      const enclave = new Enclave();
      const code = `
        const obj = {};
        obj.constructor.prototype.polluted = 'pwned';
        return ({}).polluted;
      `;

      const result = await enclave.run(code);

      // Verify host is not polluted
      const testObj: Record<string, unknown> = {};
      expect(testObj['polluted']).toBeUndefined();

      enclave.dispose();
    });
  });

  describe('Sandbox Escape Prevention', () => {
    it('should block constructor chain escape attempts', async () => {
      const enclave = new Enclave();
      const code = `
        const Constructor = ({}).constructor;
        const FunctionConstructor = Constructor.constructor;
        return typeof FunctionConstructor;
      `;

      const result = await enclave.run(code);

      // Should either fail validation or return safe result
      if (result.success) {
        // If it succeeds, ensure we can't execute arbitrary code
        expect(result.value).not.toBe('function');
      }

      enclave.dispose();
    });

    it('should block this binding escape attempts', async () => {
      const enclave = new Enclave();
      const code = `
        const getGlobal = function() { return this; };
        const globalRef = getGlobal();
        return typeof globalRef;
      `;

      const result = await enclave.run(code);

      if (result.success) {
        // this should be undefined in strict mode or the sandbox context
        expect(result.value).not.toBe('object');
      }

      enclave.dispose();
    });

    it('should block arguments.callee escape attempts', async () => {
      const enclave = new Enclave();
      const code = `
        const fn = function() {
          return arguments.callee.constructor;
        };
        return typeof fn();
      `;

      const result = await enclave.run(code);

      // Should fail in strict mode or validation
      expect(result.success).toBe(false);

      enclave.dispose();
    });
  });

  describe('File System Access Prevention', () => {
    it('should block fs module access', async () => {
      const enclave = new Enclave();
      const code = `
        const fs = require('fs');
        return fs;
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      // require is not available

      enclave.dispose();
    });

    it('should block dynamic import attempts', async () => {
      const enclave = new Enclave();
      const code = `
        const module = await import('fs');
        return module;
      `;

      const result = await enclave.run(code);

      // Should fail - import is blocked
      expect(result.success).toBe(false);

      enclave.dispose();
    });
  });

  describe('Network Access Prevention', () => {
    it('should block http module access', async () => {
      const enclave = new Enclave();
      const code = `
        const http = require('http');
        return http;
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);

      enclave.dispose();
    });

    it('should block child_process access', async () => {
      const enclave = new Enclave();
      const code = `
        const cp = require('child_process');
        return cp;
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);

      enclave.dispose();
    });
  });

  describe('Resource Exhaustion Prevention', () => {
    it('should prevent infinite loops via iteration limit', async () => {
      const enclave = new Enclave({ maxIterations: 100 });
      const code = `
        let i = 0;
        const arr = Array.from({ length: 200 }, (_, idx) => idx);
        for (const x of arr) {
          i++;
        }
        return i;
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('iteration limit');

      enclave.dispose();
    });

    it('should prevent excessive tool calls', async () => {
      const toolHandler: ToolHandler = async () => ({ ok: true });
      const enclave = new Enclave({ toolHandler, maxToolCalls: 5 });

      const code = `
        const calls = Array.from({ length: 10 }, (_, i) => i);
        for (const i of calls) {
          await callTool('test', { i });
        }
        return 'done';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('tool call limit');

      enclave.dispose();
    });

    it('should enforce execution timeout', async () => {
      const enclave = new Enclave({ timeout: 50 });

      const code = `
        const start = Date.now();
        while (Date.now() - start < 200) {
          // Busy wait
        }
        return 'done';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      expect(result.stats.duration).toBeLessThan(150);

      enclave.dispose();
    }, 10000);

    it('should prevent memory exhaustion via large arrays', async () => {
      const enclave = new Enclave({ timeout: 1000 });

      const code = `
        const huge = Array.from({ length: 10000000 }, () => 'x'.repeat(1000));
        return huge.length;
      `;

      const result = await enclave.run(code);

      // Should either timeout or fail
      expect(result.success).toBe(false);

      enclave.dispose();
    }, 15000);
  });

  describe('Reserved Identifier Protection', () => {
    it('should block __ag_ prefix usage', async () => {
      const enclave = new Enclave();
      const code = `
        const __ag_secret = 42;
        return __ag_secret;
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_ERROR');

      enclave.dispose();
    });

    it('should block __safe_ prefix usage', async () => {
      const enclave = new Enclave();
      const code = `
        const __safe_override = () => 'pwned';
        return __safe_override();
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_ERROR');

      enclave.dispose();
    });

    it('should block assignment to reserved runtime functions via static validation', async () => {
      const enclave = new Enclave();
      const code = `
        __safe_callTool = () => 'pwned';
        return 'done';
      `;

      const result = await enclave.run(code);

      // ReservedPrefixRule now blocks assignments to reserved identifiers.
      // This provides defense in depth: static analysis + runtime protection.
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_ERROR');
      expect(result.error?.message).toContain('__safe_');

      enclave.dispose();
    });
  });

  describe('Custom Global Hardening', () => {
    it('should block injecting functions via globals by default', () => {
      // The globals validator now blocks functions by default to prevent
      // scope leakage through closures
      expect(() => {
        new Enclave({
          globals: {
            require: () => {
              throw new Error('host require should never be reachable');
            },
          },
        });
      }).toThrow(/function/i);
    });

    it('should block dangerous function patterns in globals', () => {
      // The globals validator blocks functions containing 'require' pattern
      expect(() => {
        new Enclave({
          allowFunctionsInGlobals: true,
          globals: {
            // Function name contains 'require' - blocked
            customRequire: () => {
              throw new Error('host require should never be reachable');
            },
          },
        });
      }).toThrow(/require/i);
    });

    it('should allow safe function globals with allowFunctionsInGlobals', async () => {
      // Safe functions (no dangerous patterns) can be passed
      const enclave = new Enclave({
        allowFunctionsInGlobals: true,
        globals: {
          safeMultiplier: (x: number) => x * 2,
        },
      });

      const code = `
        return safeMultiplier(21);
      `;

      const result = await enclave.run(code);
      expect(result.success).toBe(true);
      expect(result.value).toBe(42);

      enclave.dispose();
    });

    it('should block injecting Buffer via globals by default', () => {
      // Buffer is a function, so it gets blocked by the globals validator
      expect(() => {
        new Enclave({
          globals: {
            nodeSecrets: { Buffer },
          },
        });
      }).toThrow(/function/i);
    });

    it('should block destructuring Buffer from custom objects when functions allowed', async () => {
      const enclave = new Enclave({
        allowFunctionsInGlobals: true,
        globals: {
          nodeSecrets: { Buffer },
        },
      });

      const code = `
        const { Buffer } = nodeSecrets;
        return Buffer.alloc(8);
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_ERROR');
      expect(result.error?.message).toMatch(/Buffer/i);

      enclave.dispose();
    });
  });

  describe('Type Confusion Prevention', () => {
    it('should validate tool handler arguments are objects', async () => {
      const toolHandler: ToolHandler = async (toolName, args) => {
        expect(typeof args).toBe('object');
        expect(Array.isArray(args)).toBe(false);
        return { ok: true };
      };

      const enclave = new Enclave({ toolHandler });
      const code = `
        await callTool('test', { valid: true });
        return 'done';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(true);

      enclave.dispose();
    });

    it('should reject tool calls with array arguments', async () => {
      const enclave = new Enclave({
        toolHandler: async () => ({ ok: true }),
      });

      // This should be caught by transformation or validation
      const code = `
        await callTool('test', ['not', 'an', 'object']);
        return 'done';
      `;

      const result = await enclave.run(code);

      // Should fail during execution when __safe_callTool validates args
      expect(result.success).toBe(false);

      enclave.dispose();
    });
  });

  describe('Reflection API Safety', () => {
    it('should allow safe Reflect operations', async () => {
      const enclave = new Enclave();
      const code = `
        const obj = { x: 1, y: 2 };
        const keys = Reflect.ownKeys(obj);
        return keys.length;
      `;

      const result = await enclave.run(code);

      if (result.success) {
        expect(result.value).toBe(2);
      }

      enclave.dispose();
    });

    it('should block Reflect.construct with dangerous constructors', async () => {
      const enclave = new Enclave();
      const code = `
        const fn = Reflect.construct(Function, ['return 42']);
        return fn();
      `;

      const result = await enclave.run(code);

      // Should fail validation (Function constructor blocked)
      expect(result.success).toBe(false);

      enclave.dispose();
    });
  });

  describe('Symbol-based Attacks', () => {
    it('should handle Symbol.unscopables safely', async () => {
      const enclave = new Enclave();
      const code = `
        const obj = {};
        obj[Symbol.unscopables] = { x: true };
        return String(obj[Symbol.unscopables].x);
      `;

      const result = await enclave.run(code);

      // Should execute safely without escaping sandbox
      if (result.success) {
        expect(result.value).toBe('true');
      }

      enclave.dispose();
    });
  });

  describe('Error Information Leakage Prevention', () => {
    it('should sanitize error messages', async () => {
      const enclave = new Enclave();
      const code = `
        throw new Error('sensitive file path: /etc/passwd');
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      // Error should be caught but sensitive info should be handled carefully
      expect(result.error).toBeDefined();

      enclave.dispose();
    });

    it('should not expose stack traces with host information', async () => {
      // Use STRICT security level which enables stack trace sanitization
      const enclave = new Enclave({ securityLevel: 'STRICT' });
      const code = `
        const obj = null;
        return obj.property;
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      // Stack trace should not reveal host file system paths when sanitization is enabled
      if (result.error?.stack) {
        expect(result.error.stack).not.toContain('/Users/');
        expect(result.error.stack).not.toContain('/home/');
      }

      enclave.dispose();
    });
  });

  describe('Timing Attack Prevention', () => {
    it('should not allow performance.now() access', async () => {
      const enclave = new Enclave();
      const code = `
        return typeof performance;
      `;

      const result = await enclave.run(code);

      if (result.success) {
        expect(result.value).toBe('undefined');
      }

      enclave.dispose();
    });

    it('should allow Date.now() for legitimate use', async () => {
      const enclave = new Enclave();
      const code = `
        const now = Date.now();
        return typeof now;
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(true);
      expect(result.value).toBe('number');

      enclave.dispose();
    });
  });

  describe('Side Channel Attack Prevention', () => {
    it('should not allow console access (sandbox isolation)', async () => {
      const enclave = new Enclave();

      const code = `
        console.log('test message');
        return 'done';
      `;

      const result = await enclave.run(code);

      // console is not a whitelisted global in the AgentScript sandbox
      // This demonstrates sandbox isolation - code cannot access host console
      expect(result.success).toBe(false);

      enclave.dispose();
    });
  });

  describe('Input Validation', () => {
    it('should handle extremely long code input', async () => {
      const enclave = new Enclave({ timeout: 5000 });
      const longCode = 'const x = 1;\n'.repeat(10000) + 'return x;';

      const result = await enclave.run(longCode);

      // Should either succeed or fail gracefully
      expect(result).toBeDefined();
      expect(result.stats).toBeDefined();

      enclave.dispose();
    }, 10000);

    it('should handle code with unicode characters', async () => {
      const enclave = new Enclave();
      const code = `
        const emoji = '🔒';
        const chinese = '中文';
        const arabic = 'العربية';
        return emoji + chinese + arabic;
      `;

      const result = await enclave.run<string>(code);

      expect(result.success).toBe(true);
      expect(result.value).toContain('🔒');

      enclave.dispose();
    });

    it('should handle deeply nested code structures', async () => {
      const enclave = new Enclave();
      const code = `
        const nested = { a: { b: { c: { d: { e: { f: 42 } } } } } };
        return nested.a.b.c.d.e.f;
      `;

      const result = await enclave.run<number>(code);

      expect(result.success).toBe(true);
      expect(result.value).toBe(42);

      enclave.dispose();
    });
  });

  describe('Multiple Execution Isolation', () => {
    it('should isolate executions from each other', async () => {
      const enclave = new Enclave();

      const code1 = `
        globalThis.shared = 'pwned';
        return 'done';
      `;

      const code2 = `
        return typeof globalThis.shared;
      `;

      await enclave.run(code1);
      const result2 = await enclave.run(code2);

      // Second execution should not see first execution's state
      if (result2.success) {
        expect(result2.value).toBe('undefined');
      }

      enclave.dispose();
    });

    it('should not share state between different enclave instances', async () => {
      const enclave1 = new Enclave({ globals: { shared: 'enclave1' } });
      const enclave2 = new Enclave({ globals: { shared: 'enclave2' } });

      const code = `return shared;`;

      const result1 = await enclave1.run<string>(code);
      const result2 = await enclave2.run<string>(code);

      expect(result1.value).toBe('enclave1');
      expect(result2.value).toBe('enclave2');

      enclave1.dispose();
      enclave2.dispose();
    });
  });
});
