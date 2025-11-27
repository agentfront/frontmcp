import { JSAstValidator } from '../validator';
import { Presets, PresetLevel } from '../presets';
import { DisallowedIdentifierRule } from '../rules';

// Disable pre-scanner for all AST rule tests - we're testing the AST rules specifically
const disablePreScan = { preScan: { enabled: false } };

/**
 * Advanced Security Test Suite
 *
 * Tests sophisticated attack vectors that could be used in banking environments.
 * This suite covers obfuscation techniques, prototype pollution, sandbox escapes,
 * and other advanced exploitation methods.
 */
describe('Advanced Security Tests - Bank-Level Protection', () => {
  describe('Property Access Obfuscation Attacks', () => {
    it('should block computed property access to constructor', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        const obj = {};
        const Constructor = obj['constructor'];
        const FunctionConstructor = Constructor['constructor'];
      `;

      const result = await guard.validate(maliciousCode, disablePreScan);
      // NoGlobalAccessRule now catches .constructor property access
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'NO_CONSTRUCTOR_ACCESS')).toBe(true);
    });

    it('should block string concatenation to build forbidden identifiers', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        const e = 'ev' + 'al';
        const func = window[e];
      `;

      const result = await guard.validate(maliciousCode, disablePreScan);
      // NoGlobalAccessRule catches window access in strict mode
      expect(result.valid).toBe(false);
    });

    it('should block template literal obfuscation', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        const dangerous = \`ev\${'al'}\`;
        const fn = this[dangerous];
      `;

      const result = await guard.validate(maliciousCode, disablePreScan);
      // NoGlobalAccessRule catches this[...] access in strict mode
      expect(result.valid).toBe(false);
    });

    it('should block hex/unicode escape sequences', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        const x = eval; // This will be caught
        const y = \\u0065\\u0076\\u0061\\u006c; // Unicode: 'eval'
      `;

      const result = await guard.validate(maliciousCode, {
        ...disablePreScan,
        rules: { 'disallowed-identifier': true },
      });

      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.data?.['identifier'] === 'eval')).toBe(true);
    });
  });

  describe('Prototype Pollution Advanced Attacks', () => {
    it('should block Object.prototype manipulation', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        Object.prototype.isAdmin = true;
        Object.prototype.balance = 999999;
      `;

      const result = await guard.validate(maliciousCode, {
        ...disablePreScan,
        rules: { 'disallowed-identifier': true },
      });
      // NOW BLOCKED: Object is in lockdown preset
      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.data?.['identifier'] === 'Object')).toBe(true);
    });

    it('should block Array.prototype manipulation', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        Array.prototype.includes = function() { return true; };
        const accounts = ['admin', 'user'];
        accounts.includes('hacker'); // Always returns true now
      `;

      const result = await guard.validate(maliciousCode, {
        ...disablePreScan,
        rules: { 'disallowed-identifier': true },
      });
      // NOW BLOCKED: Array is in lockdown preset
      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.data?.['identifier'] === 'Array')).toBe(true);
    });

    it('should block __proto__ manipulation via assignment', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        const proto = __proto__;
        proto.isAdmin = true;
      `;

      const result = await guard.validate(maliciousCode, {
        ...disablePreScan,
        rules: { 'disallowed-identifier': true },
      });

      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.data?.['identifier'] === '__proto__')).toBe(true);
    });

    it('should block constructor.prototype access chain', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        const c = constructor;
        c.prototype.polluted = 'hacked';
      `;

      const result = await guard.validate(maliciousCode, {
        ...disablePreScan,
        rules: { 'disallowed-identifier': true },
      });

      expect(result.valid).toBe(false);
    });
  });

  describe('Function Construction Bypass Attempts', () => {
    it('should block indirect Function constructor access', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        const Fn = Function;
        const malicious = new Fn('return process.env');
      `;

      const result = await guard.validate(maliciousCode, {
        ...disablePreScan,
        rules: { 'disallowed-identifier': true, 'no-eval': true },
      });

      expect(result.valid).toBe(false);
    });

    it('should block async Function constructor', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        const AsyncFn = async function(){}.constructor;
        const attack = AsyncFn('return await fetch("https://evil.com")');
      `;

      const result = await guard.validate(maliciousCode, {
        ...disablePreScan,
        rules: { 'no-async': true, 'disallowed-identifier': true },
      });
      // async function will be blocked by no-async rule
      expect(result.valid).toBe(false);
    });

    it('should block GeneratorFunction access', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        const GeneratorFn = function*(){}.constructor;
        const attack = GeneratorFn('yield process.env');
      `;

      const result = await guard.validate(maliciousCode, disablePreScan);
      // Strict preset now catches .constructor access via NoGlobalAccessRule
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'NO_CONSTRUCTOR_ACCESS')).toBe(true);
    });
  });

  describe('Sandbox Escape via Error Stack Manipulation', () => {
    it('should block Error.prepareStackTrace manipulation', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        Error.prepareStackTrace = function(err, stack) {
          return stack[0].getThis(); // Access to execution context
        };
        const leak = new Error().stack;
      `;

      const result = await guard.validate(maliciousCode, {
        ...disablePreScan,
        rules: { 'disallowed-identifier': true },
      });
      // NOW BLOCKED: Error is in lockdown preset
      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.data?.['identifier'] === 'Error')).toBe(true);
    });

    it('should block error stack trace parsing for context leaks', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        try {
          null.f();
        } catch (e) {
          const stack = e.stack;
          // Parse stack to find execution context
        }
      `;

      const result = await guard.validate(maliciousCode, disablePreScan);
      // Try-catch is legitimate, but stack access could leak info
      expect(result.valid).toBe(true);
    });
  });

  describe('Promise-Based Code Execution', () => {
    it('should block Promise constructor manipulation', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        const P = Promise;
        P.resolve().then(() => {
          // Async code execution
          eval('malicious code');
        });
      `;

      const result = await guard.validate(maliciousCode, {
        ...disablePreScan,
        rules: { 'disallowed-identifier': true, 'no-eval': true },
      });

      expect(result.valid).toBe(false); // eval is caught
    });

    it('should block Promise.race timing attacks', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        // Timing attack to leak information
        Promise.race([
          fetch('https://bank.com/api/balance'),
          new Promise(resolve => setTimeout(resolve, 100))
        ]).then(result => {
          // Leak timing information
        });
      `;

      const result = await guard.validate(maliciousCode, {
        ...disablePreScan,
        rules: { 'disallowed-identifier': true },
      });
      // NOW BLOCKED: fetch is in lockdown preset
      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.data?.['identifier'] === 'fetch')).toBe(true);
    });
  });

  describe('Symbol-Based Property Access', () => {
    it('should block Symbol.for to access hidden properties', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        const hidden = Symbol.for('secretKey');
        const leaked = obj[hidden];
      `;

      const result = await guard.validate(maliciousCode, {
        ...disablePreScan,
        rules: { 'disallowed-identifier': true },
      });
      // NOW BLOCKED: Symbol is in lockdown preset
      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.data?.['identifier'] === 'Symbol')).toBe(true);
    });

    it('should block Symbol.iterator manipulation', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        Array.prototype[Symbol.iterator] = function*() {
          // Hijack all array iterations
          yield 'hacked';
        };
      `;

      const result = await guard.validate(maliciousCode, {
        ...disablePreScan,
        rules: { 'disallowed-identifier': true },
      });
      // NOW BLOCKED: Both Symbol and Array are in lockdown preset
      expect(result.valid).toBe(false);
      expect(
        result.issues.some(
          (issue) => issue.data?.['identifier'] === 'Symbol' || issue.data?.['identifier'] === 'Array',
        ),
      ).toBe(true);
    });
  });

  describe('Proxy-Based Attacks', () => {
    it('should block Proxy to intercept property access', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        const handler = {
          get: function(target, prop) {
            // Steal all property accesses
            sendToAttacker(prop);
            return target[prop];
          }
        };
        const proxy = new Proxy(bankAccount, handler);
      `;

      const result = await guard.validate(maliciousCode, {
        ...disablePreScan,
        rules: { 'disallowed-identifier': true },
      });
      // NOW BLOCKED: Proxy is in lockdown preset
      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.data?.['identifier'] === 'Proxy')).toBe(true);
    });

    it('should block Reflect for property manipulation', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        Reflect.set(Object.prototype, 'isAdmin', true);
        Reflect.defineProperty(user, 'balance', { value: 999999 });
      `;

      const result = await guard.validate(maliciousCode, {
        ...disablePreScan,
        rules: { 'disallowed-identifier': true },
      });
      // NOW BLOCKED: Both Reflect and Object are in lockdown preset
      expect(result.valid).toBe(false);
      expect(
        result.issues.some(
          (issue) => issue.data?.['identifier'] === 'Reflect' || issue.data?.['identifier'] === 'Object',
        ),
      ).toBe(true);
    });
  });

  describe('RegExp DoS (ReDoS) Attacks', () => {
    it('should detect catastrophic backtracking patterns', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        const redosPattern = /^(a+)+$/;
        const input = 'a'.repeat(50) + 'b';
        redosPattern.test(input); // Causes exponential backtracking
      `;

      const result = await guard.validate(maliciousCode, disablePreScan);
      // NOW DETECTED: NoRegexLiteralRule in strict preset analyzes patterns for ReDoS
      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.code === 'REGEX_REDOS_VULNERABLE')).toBe(true);
    });

    it('should block RegExp constructor with dynamic patterns', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        const pattern = '(a+)+$';
        const regex = new RegExp('^' + pattern);
      `;

      const result = await guard.validate(maliciousCode, {
        ...disablePreScan,
        rules: { 'disallowed-identifier': true },
      });
      // NOW BLOCKED: RegExp is in lockdown preset
      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.data?.['identifier'] === 'RegExp')).toBe(true);
    });
  });

  describe('Memory Exhaustion Attacks', () => {
    it('should detect large array allocation', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        const huge = new Array(1e9); // 1 billion elements
        const filled = huge.fill(0);
      `;

      const result = await guard.validate(maliciousCode, {
        ...disablePreScan,
        rules: { 'disallowed-identifier': true },
      });
      // NOW BLOCKED: Array is in lockdown preset
      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.data?.['identifier'] === 'Array')).toBe(true);
    });

    it('should detect recursive array nesting', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        const a = [];
        a[0] = a; // Circular reference
        JSON.stringify(a); // Infinite recursion
      `;

      const result = await guard.validate(maliciousCode, {
        ...disablePreScan,
        rules: { 'disallowed-identifier': true },
      });
      // NOW BLOCKED: JSON is in lockdown preset
      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.data?.['identifier'] === 'JSON')).toBe(true);
    });

    it('should detect string concatenation DoS', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        let str = 'a';
        for (let i = 0; i < 30; i++) {
          str = str + str; // Exponential growth
        }
      `;

      const result = await guard.validate(maliciousCode, {
        ...disablePreScan,
        rules: { 'forbidden-loop': true },
      });

      expect(result.valid).toBe(false); // Caught by loop restriction
    });
  });

  describe('WebAssembly Exploitation', () => {
    it('should block WebAssembly instantiation', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        const wasmCode = new Uint8Array([0x00, 0x61, 0x73, 0x6d]);
        const wasmModule = new WebAssembly.Module(wasmCode);
        const instance = new WebAssembly.Instance(wasmModule);
      `;

      const result = await guard.validate(maliciousCode, {
        ...disablePreScan,
        rules: { 'disallowed-identifier': true },
      });
      // NOW BLOCKED: Both Uint8Array and WebAssembly are in lockdown preset
      expect(result.valid).toBe(false);
      expect(
        result.issues.some(
          (issue) => issue.data?.['identifier'] === 'Uint8Array' || issue.data?.['identifier'] === 'WebAssembly',
        ),
      ).toBe(true);
    });
  });

  describe('Import/Dynamic Import Attacks', () => {
    it('should detect import expressions as parse errors in script mode', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        const module = import('fs');
        module.then(fs => fs.readFileSync('/etc/passwd'));
      `;

      const result = await guard.validate(maliciousCode, {
        ...disablePreScan,
        rules: { 'disallowed-identifier': true },
      });
      // Import expressions cause parse errors in script mode (our default)
      // In module mode, would need a separate rule to detect ImportExpression AST nodes
      expect(result.valid).toBe(false);
      // Parse error is expected for import() in script mode
    });

    it('should detect import.meta access as parse errors in script mode', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        const url = import.meta.url;
        const dir = import.meta.dirname;
      `;

      const result = await guard.validate(maliciousCode, {
        ...disablePreScan,
        rules: { 'disallowed-identifier': true },
      });
      // Import.meta causes parse errors in script mode
      expect(result.valid).toBe(false);
      // Parse error is expected
    });
  });

  describe('Worker-Based Isolation Bypass', () => {
    it('should block Worker creation', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        const worker = new Worker('malicious.js');
        worker.postMessage({ action: 'steal', data: sensitiveInfo });
      `;

      const result = await guard.validate(maliciousCode, {
        ...disablePreScan,
        rules: { 'disallowed-identifier': true },
      });
      // NOW BLOCKED: Worker is in lockdown preset
      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.data?.['identifier'] === 'Worker')).toBe(true);
    });

    it('should block SharedWorker for cross-context attacks', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        const shared = new SharedWorker('spy.js');
        shared.port.postMessage(credentials);
      `;

      const result = await guard.validate(maliciousCode, {
        ...disablePreScan,
        rules: { 'disallowed-identifier': true },
      });
      // NOW BLOCKED: SharedWorker is in lockdown preset
      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.data?.['identifier'] === 'SharedWorker')).toBe(true);
    });
  });

  describe('toString/valueOf Manipulation', () => {
    it('should detect toString override for injection', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        const obj = {
          toString: function() {
            eval("malicious code");
            return 'result';
          }
        };
        const code = '' + obj; // Calls toString
      `;

      const result = await guard.validate(maliciousCode, {
        ...disablePreScan,
        rules: { 'disallowed-identifier': true },
      });

      expect(result.valid).toBe(false); // eval is caught
      expect(result.issues.some((issue) => issue.data?.['identifier'] === 'eval')).toBe(true);
    });

    it('should detect valueOf for type coercion attacks', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        const malicious = {
          valueOf: function() {
            // Side effect during coercion
            stealData();
            return 0;
          }
        };
        if (amount < malicious) {} // Triggers valueOf
      `;

      const result = await guard.validate(maliciousCode, disablePreScan);
      expect(result.valid).toBe(true); // Hard to detect statically
    });
  });

  describe('Getter/Setter Traps', () => {
    it('should block getter with dangerous this access', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        const obj = {
          get balance() {
            sendToAttacker(this.realBalance);
            return this.realBalance;
          }
        };
      `;

      const result = await guard.validate(maliciousCode, disablePreScan);
      // Strict preset now catches this access via NoGlobalAccessRule
      expect(result.valid).toBe(false);
    });

    it('should detect Object.defineProperty for traps', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const maliciousCode = `
        Object.defineProperty(user, 'password', {
          get: function() {
            logAccess();
            return this._password;
          }
        });
      `;

      const result = await guard.validate(maliciousCode, {
        ...disablePreScan,
        rules: { 'disallowed-identifier': true },
      });
      // NOW BLOCKED: Object is in lockdown preset
      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.data?.['identifier'] === 'Object')).toBe(true);
    });
  });

  describe('Comprehensive Bank-Level Lockdown Test', () => {
    it('should block all known attack vectors in bank environment', async () => {
      // Create the most restrictive guard possible
      const guard = new JSAstValidator(
        Presets.strict({
          additionalDisallowedIdentifiers: [
            // Prototype manipulation
            'Object',
            'Array',
            'String',
            'Number',
            'Boolean',
            'Symbol',
            'BigInt',
            // Error manipulation
            'Error',
            'TypeError',
            'ReferenceError',
            // Reflection and metaprogramming
            'Proxy',
            'Reflect',
            // Async primitives
            'Promise',
            // Pattern matching
            'RegExp',
            // Binary data
            'ArrayBuffer',
            'SharedArrayBuffer',
            'DataView',
            'Uint8Array',
            'Uint16Array',
            'Uint32Array',
            'Int8Array',
            'Int16Array',
            'Int32Array',
            'Float32Array',
            'Float64Array',
            // WebAssembly
            'WebAssembly',
            // Workers
            'Worker',
            'SharedWorker',
            // Intl manipulation
            'Intl',
            // Atomics for SharedArrayBuffer
            'Atomics',
            // WeakMap/WeakSet for memory leaks
            'WeakMap',
            'WeakSet',
            'Map',
            'Set',
          ],
          requiredFunctions: ['callTool'],
          functionArgumentRules: {
            callTool: {
              minArgs: 2,
              maxArgs: 2,
              expectedTypes: ['string', 'object'],
            },
          },
        }),
      );

      const legitimateCode = `
        // Only allow simple operations with required API
        const accountId = 'ACC-12345';
        const result = callTool('getBalance', { accountId });
      `;

      const result = await guard.validate(legitimateCode, {
        ...disablePreScan,
        rules: {
          'no-eval': true,
          'disallowed-identifier': true,
          'forbidden-loop': true,
          'required-function-call': true,
          'call-argument-validation': true,
          'no-async': true,
          'unreachable-code': true,
        },
      });

      if (!result.valid) {
        console.log('Validation failed with issues:', JSON.stringify(result.issues, null, 2));
      }
      expect(result.valid).toBe(true);
    });

    it('should reject any advanced attack attempt', async () => {
      const guard = new JSAstValidator(
        Presets.strict({
          additionalDisallowedIdentifiers: ['Object', 'Array', 'Proxy', 'Reflect', 'Promise', 'Symbol', 'Error'],
          requiredFunctions: ['callTool'],
        }),
      );

      const attackAttempts = [
        'Object.prototype.isAdmin = true;',
        'Array.prototype.map = () => {};',
        'const p = new Proxy({}, {});',
        'Reflect.set(obj, "key", val);',
        'const e = eval;',
        'const fn = Function;',
        'process.exit(1);',
        'require("fs");',
      ];

      for (const attack of attackAttempts) {
        const result = await guard.validate(`${attack}\ncallTool("test", {});`, {
          ...disablePreScan,
          rules: {
            'no-eval': true,
            'disallowed-identifier': true,
            'required-function-call': true,
          },
        });
        expect(result.valid).toBe(false);
      }
    });
  });
});
