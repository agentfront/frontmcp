import { JSAstValidator, ValidationSeverity } from '../index';
import { DisallowedIdentifierRule } from '../rules/disallowed-identifier.rule';

describe('AST Transformer', () => {
  describe('Basic identifier transformation', () => {
    it('should transform simple identifiers', async () => {
      const validator = new JSAstValidator([]);
      const code = `console.log('hello');`;

      const result = await validator.validate(code, {
        parseOptions: {
          ecmaVersion: 'latest',
          sourceType: 'script',
        },
        transform: {
          enabled: true,
          prefix: '__safe_',
          identifiers: ['console'],
          transformComputed: true,
        },
      });

      expect(result.valid).toBe(true);
      expect(result.transformedCode).toBeDefined();
      expect(result.transformedCode).toContain('__safe_console');
    });

    it('should transform multiple identifiers', async () => {
      const validator = new JSAstValidator([]);
      const code = `
        console.log('test');
        callTool('foo');
        const x = getTool('bar');
      `;

      const result = await validator.validate(code, {
        parseOptions: {
          ecmaVersion: 'latest',
          sourceType: 'script',
        },
        transform: {
          enabled: true,
          prefix: '__safe_',
          identifiers: ['console', 'callTool', 'getTool'],
          transformComputed: true,
        },
      });

      expect(result.valid).toBe(true);
      expect(result.transformedCode).toContain('__safe_console');
      expect(result.transformedCode).toContain('__safe_callTool');
      expect(result.transformedCode).toContain('__safe_getTool');
    });

    it('should not transform identifiers when disabled', async () => {
      const validator = new JSAstValidator([]);
      const code = `console.log('hello');`;

      const result = await validator.validate(code, {
        parseOptions: {
          ecmaVersion: 'latest',
          sourceType: 'script',
        },
        transform: {
          enabled: false,
          prefix: '__safe_',
          identifiers: ['console'],
          transformComputed: true,
        },
      });

      expect(result.valid).toBe(true);
      expect(result.transformedCode).toBeUndefined();
    });

    it('should not transform when no identifiers specified', async () => {
      const validator = new JSAstValidator([]);
      const code = `console.log('hello');`;

      const result = await validator.validate(code, {
        parseOptions: {
          ecmaVersion: 'latest',
          sourceType: 'script',
        },
        transform: {
          enabled: true,
          prefix: '__safe_',
          identifiers: [],
          transformComputed: true,
        },
      });

      expect(result.valid).toBe(true);
      expect(result.transformedCode).toBeDefined();
      expect(result.transformedCode).toContain('console'); // Not transformed
      expect(result.transformedCode).not.toContain('__safe_console');
    });
  });

  describe('Computed member expression transformation', () => {
    it('should transform computed member expressions with string literals', async () => {
      const validator = new JSAstValidator([]);
      const code = `obj['eval']();`;

      const result = await validator.validate(code, {
        parseOptions: {
          ecmaVersion: 'latest',
          sourceType: 'script',
        },
        transform: {
          enabled: true,
          prefix: '__safe_',
          identifiers: ['eval'],
          transformComputed: true,
        },
      });

      expect(result.valid).toBe(true);
      // Check that transformation happened - either obj['__safe_eval'] or obj.__safe_eval
      expect(result.transformedCode).toMatch(/__safe_eval/);
    });

    it('should transform computed member expressions with template literals', async () => {
      const validator = new JSAstValidator([]);
      const code = 'obj[`eval`]();';

      const result = await validator.validate(code, {
        parseOptions: {
          ecmaVersion: 'latest',
          sourceType: 'script',
        },
        transform: {
          enabled: true,
          prefix: '__safe_',
          identifiers: ['eval'],
          transformComputed: true,
        },
      });

      expect(result.valid).toBe(true);
      expect(result.transformedCode).toContain('__safe_eval');
    });

    it('should not transform computed member expressions when transformComputed is false', async () => {
      const validator = new JSAstValidator([]);
      const code = `obj['eval']();`;

      const result = await validator.validate(code, {
        parseOptions: {
          ecmaVersion: 'latest',
          sourceType: 'script',
        },
        transform: {
          enabled: true,
          prefix: '__safe_',
          identifiers: ['eval'],
          transformComputed: false,
        },
      });

      expect(result.valid).toBe(true);
      expect(result.transformedCode).toBeDefined();
      // Original code should have 'eval' not '__safe_eval' in computed access
      // Use regex to handle either single or double quotes from code generator
      expect(result.transformedCode).toMatch(/["']eval["']/);
      expect(result.transformedCode).not.toMatch(/["']__safe_eval["']/);
    });

    it('should not transform non-matching computed member expressions', async () => {
      const validator = new JSAstValidator([]);
      const code = `obj['foo']();`;

      const result = await validator.validate(code, {
        parseOptions: {
          ecmaVersion: 'latest',
          sourceType: 'script',
        },
        transform: {
          enabled: true,
          prefix: '__safe_',
          identifiers: ['eval'],
          transformComputed: true,
        },
      });

      expect(result.valid).toBe(true);
      // Use regex to handle either single or double quotes from code generator
      expect(result.transformedCode).toMatch(/["']foo["']/);
      expect(result.transformedCode).not.toContain('__safe_');
    });
  });

  describe('Custom prefix', () => {
    it('should use custom prefix', async () => {
      const validator = new JSAstValidator([]);
      const code = `console.log('hello');`;

      const result = await validator.validate(code, {
        parseOptions: {
          ecmaVersion: 'latest',
          sourceType: 'script',
        },
        transform: {
          enabled: true,
          prefix: '__custom_',
          identifiers: ['console'],
          transformComputed: true,
        },
      });

      expect(result.valid).toBe(true);
      expect(result.transformedCode).toContain('__custom_console');
      expect(result.transformedCode).not.toContain('__safe_console');
    });
  });

  describe('Complex code transformation', () => {
    it('should transform complex code with multiple patterns', async () => {
      const validator = new JSAstValidator([]);
      const code = `
        async function test() {
          console.log('starting');
          const result = await callTool('foo', { bar: 'baz' });
          const tool = getTool('bar');
          const ctx = codecallContext;
          return obj['eval'](result);
        }
      `;

      const result = await validator.validate(code, {
        parseOptions: {
          ecmaVersion: 'latest',
          sourceType: 'script',
          allowReturnOutsideFunction: true,
          allowAwaitOutsideFunction: true,
        },
        transform: {
          enabled: true,
          prefix: '__safe_',
          identifiers: ['console', 'callTool', 'getTool', 'codecallContext', 'eval'],
          transformComputed: true,
        },
      });

      expect(result.valid).toBe(true);
      expect(result.transformedCode).toContain('__safe_console');
      expect(result.transformedCode).toContain('__safe_callTool');
      expect(result.transformedCode).toContain('__safe_getTool');
      expect(result.transformedCode).toContain('__safe_codecallContext');
      expect(result.transformedCode).toMatch(/__safe_eval/);
    });

    it('should preserve code structure and logic', async () => {
      const validator = new JSAstValidator([]);
      const code = `
        if (true) {
          console.log('test');
        } else {
          console.error('error');
        }
      `;

      const result = await validator.validate(code, {
        parseOptions: {
          ecmaVersion: 'latest',
          sourceType: 'script',
        },
        transform: {
          enabled: true,
          prefix: '__safe_',
          identifiers: ['console'],
          transformComputed: true,
        },
      });

      expect(result.valid).toBe(true);
      expect(result.transformedCode).toContain('if (true)');
      expect(result.transformedCode).toContain('else');
      expect(result.transformedCode).toContain('__safe_console');
    });
  });

  describe('Error handling', () => {
    it('should succeed with valid transformation', async () => {
      const validator = new JSAstValidator([]);
      const code = `console.log('hello');`;

      const result = await validator.validate(code, {
        parseOptions: {
          ecmaVersion: 'latest',
          sourceType: 'script',
        },
        transform: {
          enabled: true,
          prefix: '__safe_',
          identifiers: ['console'],
          transformComputed: true,
        },
      });

      // Normal case should succeed
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should still perform transformation even if validation has warnings', async () => {
      const validator = new JSAstValidator([new DisallowedIdentifierRule({ disallowed: ['console'] })]);
      const code = `const x = 1; console.log(x);`;

      const result = await validator.validate(code, {
        parseOptions: {
          ecmaVersion: 'latest',
          sourceType: 'script',
        },
        rules: {
          'disallowed-identifier': {
            enabled: true,
            severity: ValidationSeverity.WARNING,
          },
        },
        transform: {
          enabled: true,
          prefix: '__safe_',
          identifiers: ['console'],
          transformComputed: true,
        },
      });

      // Should have warning but still transform
      expect(result.valid).toBe(true); // valid=true because no errors, only warnings
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.transformedCode).toContain('__safe_console');
    });
  });

  describe('Integration with validation', () => {
    it('should validate first, then transform', async () => {
      const validator = new JSAstValidator([new DisallowedIdentifierRule({ disallowed: ['eval'] })]);
      const code = `eval('test');`;

      const result = await validator.validate(code, {
        parseOptions: {
          ecmaVersion: 'latest',
          sourceType: 'script',
        },
        rules: {
          'disallowed-identifier': {
            enabled: true,
          },
        },
        transform: {
          enabled: true,
          prefix: '__safe_',
          identifiers: ['eval'],
          transformComputed: true,
        },
      });

      // Should fail validation
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      // Should still produce transformed code
      expect(result.transformedCode).toBeDefined();
      expect(result.transformedCode).toContain('__safe_eval');
    });
  });

  describe('Whitelist mode edge cases', () => {
    it('should not transform function declarations in whitelist mode', async () => {
      const validator = new JSAstValidator([]);
      const code = `
        function myFunc(param1, param2) {
          return param1 + param2;
        }
        myFunc(1, 2);
      `;

      const result = await validator.validate(code, {
        parseOptions: {
          ecmaVersion: 'latest',
          sourceType: 'script',
        },
        transform: {
          enabled: true,
          prefix: '__safe_',
          mode: 'whitelist',
          whitelistedIdentifiers: [],
        },
      });

      expect(result.valid).toBe(true);
      // Function name and params should NOT be transformed
      expect(result.transformedCode).toContain('function myFunc');
      expect(result.transformedCode).toContain('param1');
      expect(result.transformedCode).toContain('param2');
    });

    it('should not transform function expressions in whitelist mode', async () => {
      const validator = new JSAstValidator([]);
      const code = `
        const add = function(a, b) {
          return a + b;
        };
        add(1, 2);
      `;

      const result = await validator.validate(code, {
        parseOptions: {
          ecmaVersion: 'latest',
          sourceType: 'script',
        },
        transform: {
          enabled: true,
          prefix: '__safe_',
          mode: 'whitelist',
          whitelistedIdentifiers: [],
        },
      });

      expect(result.valid).toBe(true);
      // Function params should NOT be transformed (param names preserved)
      expect(result.transformedCode).toContain('a');
      expect(result.transformedCode).toContain('b');
      expect(result.transformedCode).not.toContain('__safe_a');
      expect(result.transformedCode).not.toContain('__safe_b');
    });

    it('should not transform catch clause parameters in whitelist mode', async () => {
      const validator = new JSAstValidator([]);
      const code = `
        try {
          throw new Error('test');
        } catch (error) {
          const msg = error.message;
        }
      `;

      const result = await validator.validate(code, {
        parseOptions: {
          ecmaVersion: 'latest',
          sourceType: 'script',
        },
        transform: {
          enabled: true,
          prefix: '__safe_',
          mode: 'whitelist',
          whitelistedIdentifiers: ['Error'],
        },
      });

      expect(result.valid).toBe(true);
      // catch error param should NOT be transformed
      expect(result.transformedCode).toContain('catch (error)');
      expect(result.transformedCode).toContain('error.message');
    });
  });

  describe('Identifier context edge cases', () => {
    it('should not transform property keys in object literals', async () => {
      const validator = new JSAstValidator([]);
      const code = `
        const obj = { console: 'value', log: true };
      `;

      const result = await validator.validate(code, {
        parseOptions: {
          ecmaVersion: 'latest',
          sourceType: 'script',
        },
        transform: {
          enabled: true,
          prefix: '__safe_',
          identifiers: ['console', 'log'],
        },
      });

      expect(result.valid).toBe(true);
      // Property keys should NOT be transformed
      expect(result.transformedCode).toContain('console:');
      expect(result.transformedCode).toContain('log:');
      expect(result.transformedCode).not.toContain('__safe_console:');
      expect(result.transformedCode).not.toContain('__safe_log:');
    });

    it('should not transform method definition names', async () => {
      const validator = new JSAstValidator([]);
      const code = `
        const obj = {
          console() {
            return 'method';
          }
        };
      `;

      const result = await validator.validate(code, {
        parseOptions: {
          ecmaVersion: 'latest',
          sourceType: 'script',
        },
        transform: {
          enabled: true,
          prefix: '__safe_',
          identifiers: ['console'],
        },
      });

      expect(result.valid).toBe(true);
      // Method name should NOT be transformed
      expect(result.transformedCode).toContain('console()');
      expect(result.transformedCode).not.toContain('__safe_console()');
    });

    it('should not transform import specifiers', async () => {
      const validator = new JSAstValidator([]);
      const code = `
        import { console as myConsole } from 'module';
      `;

      const result = await validator.validate(code, {
        parseOptions: {
          ecmaVersion: 'latest',
          sourceType: 'module',
        },
        transform: {
          enabled: true,
          prefix: '__safe_',
          identifiers: ['console'],
        },
      });

      expect(result.valid).toBe(true);
      // Import specifier should NOT be transformed
      expect(result.transformedCode).toContain('console');
      expect(result.transformedCode).toContain('myConsole');
      expect(result.transformedCode).not.toContain('__safe_console');
    });

    it('should not transform function parameter declarations', async () => {
      const validator = new JSAstValidator([]);
      const code = `
        function test(console) {
          return console;
        }
      `;

      const result = await validator.validate(code, {
        parseOptions: {
          ecmaVersion: 'latest',
          sourceType: 'script',
        },
        transform: {
          enabled: true,
          prefix: '__safe_',
          identifiers: ['console'],
        },
      });

      expect(result.valid).toBe(true);
      // Parameter name should NOT be transformed in declaration
      expect(result.transformedCode).toContain('function test(console)');
    });

    it('should not transform variable declarator names', async () => {
      const validator = new JSAstValidator([]);
      const code = `
        const console = 'shadowed';
        const x = console;
      `;

      const result = await validator.validate(code, {
        parseOptions: {
          ecmaVersion: 'latest',
          sourceType: 'script',
        },
        transform: {
          enabled: true,
          prefix: '__safe_',
          identifiers: ['console'],
        },
      });

      expect(result.valid).toBe(true);
      // Variable declaration name should NOT be transformed
      expect(result.transformedCode).toContain('const console =');
    });
  });
});
