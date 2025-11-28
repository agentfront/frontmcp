/**
 * AgentScript Transformer Tests
 *
 * Tests the transformation of AgentScript code:
 * - Script wrapping in async function __ag_main()
 * - Whitelist-based identifier transformation
 * - Loop transformations
 */

import { transformAgentScript, isWrappedInMain, unwrapFromMain } from '../agentscript-transformer';

describe('AgentScript Transformer', () => {
  describe('Script Wrapping', () => {
    it('should wrap simple code in async function __ag_main()', () => {
      const input = `const users = await callTool('users:list', {});`;

      const output = transformAgentScript(input, {
        wrapInMain: true,
        transformCallTool: false,
        transformLoops: false,
      });

      expect(output).toContain('async function __ag_main()');
      expect(output).toContain('const users = await callTool');
    });

    it('should wrap multiple statements', () => {
      const input = `
        const users = await callTool('users:list', {});
        const result = users.items.map(u => u.name);
        return result;
      `;

      const output = transformAgentScript(input, {
        wrapInMain: true,
        transformCallTool: false,
        transformLoops: false,
      });

      expect(output).toContain('async function __ag_main()');
      expect(output).toContain('const users');
      expect(output).toContain('const result');
      expect(output).toContain('return result');
    });

    it('should double-wrap if caller does not check isWrappedInMain first', () => {
      const input = `
        async function __ag_main() {
          const data = await callTool('getData', {});
          return data;
        }
      `;

      // Check if already wrapped
      expect(isWrappedInMain(input)).toBe(true);

      // Transform anyway (user's responsibility to check isWrappedInMain first)
      const output = transformAgentScript(input, {
        wrapInMain: true,
        transformCallTool: false,
        transformLoops: false,
      });

      // Double-wrapping occurs - caller must check isWrappedInMain first to prevent this
      const mainCount = (output.match(/__ag_main/g) || []).length;
      expect(mainCount).toBeGreaterThanOrEqual(2); // Nested
    });
  });

  describe('Whitelist-based Identifier Transformation', () => {
    it('should transform callTool → __safe_callTool', () => {
      const input = `const users = await callTool('users:list', {});`;

      const output = transformAgentScript(input, {
        wrapInMain: false,
        transformCallTool: true,
        transformLoops: false,
      });

      expect(output).toContain('__safe_callTool');
      // Verify no standalone callTool (without __safe_ prefix)
      // Use regex to match callTool that's NOT preceded by __safe_
      expect(output).not.toMatch(/(?<!__safe_)callTool\(/);
    });

    it('should NOT transform whitelisted globals (Math, JSON, Array, etc.)', () => {
      const input = `
        const max = Math.max(1, 2, 3);
        const str = JSON.stringify({ foo: 'bar' });
        const arr = Array.from([1, 2, 3]);
        const num = Number(42);
        const date = Date.now();
      `;

      const output = transformAgentScript(input, {
        wrapInMain: false,
        transformCallTool: true,
        transformLoops: false,
      });

      // These should NOT be transformed
      expect(output).toContain('Math.max');
      expect(output).toContain('JSON.stringify');
      expect(output).toContain('Array.from');
      expect(output).toContain('Number(42)');
      expect(output).toContain('Date.now');

      // They should NOT have __safe_ prefix
      expect(output).not.toContain('__safe_Math');
      expect(output).not.toContain('__safe_JSON');
      expect(output).not.toContain('__safe_Array');
      expect(output).not.toContain('__safe_Number');
      expect(output).not.toContain('__safe_Date');
    });

    it('should NOT transform locally-declared variables and parameters', () => {
      const input = `
        const users = await callTool('users:list', {});
        const result = users.items.map(u => u.name);
        return result;
      `;

      const output = transformAgentScript(input, {
        wrapInMain: false,
        transformCallTool: true,
        transformLoops: false,
      });

      // callTool should be transformed (it's a global)
      expect(output).toContain('__safe_callTool');

      // Local variables should NOT be transformed
      // The transformer correctly skips locally-declared identifiers
      expect(output).not.toContain('__safe_users');
      expect(output).not.toContain('__safe_result');

      // Variable declarations should be preserved as-is
      expect(output).toContain('const users');
      expect(output).toContain('const result');

      // References to locals should also be preserved
      expect(output).toContain('users.items');
      expect(output).toContain('return result');
    });

    it('should NOT transform property access on locally-declared variables', () => {
      const input = `
        const users = await callTool('users:list', {});
        const names = users.items.map(u => u.name);
      `;

      const output = transformAgentScript(input, {
        wrapInMain: false,
        transformCallTool: true,
        transformLoops: false,
      });

      // Local variables should NOT be transformed
      // The transformer correctly identifies locally-declared identifiers
      expect(output).toContain('users.items');
      expect(output).not.toContain('__safe_users');

      // Arrow function parameter references should also NOT be transformed
      expect(output).toContain('u.name');
      expect(output).not.toContain('__safe_u');
    });

    it('should NOT transform keywords and literals', () => {
      const input = `
        const x = null;
        const y = undefined;
        const z = true;
        if (isNaN(x)) return false;
        for (let i = 0; i < 10; i++) {
          console.log(i);
        }
      `;

      const output = transformAgentScript(input, {
        wrapInMain: false,
        transformCallTool: true,
        transformLoops: false,
      });

      // Keywords should NOT be transformed
      expect(output).toContain('null');
      expect(output).toContain('undefined');
      expect(output).toContain('true');
      expect(output).toContain('false');
      expect(output).toContain('return');
      expect(output).toContain('if');
      expect(output).toContain('for');
      expect(output).toContain('let');
      expect(output).toContain('const');

      // isNaN is whitelisted
      expect(output).toContain('isNaN');
      expect(output).not.toContain('__safe_isNaN');
    });
  });

  describe('Loop Transformation', () => {
    it('should transform for-of loops with __safe_forOf', () => {
      const input = `
        for (const user of users.items) {
          console.log(user.name);
        }
      `;

      const output = transformAgentScript(input, {
        wrapInMain: false,
        transformCallTool: false,
        transformLoops: true,
      });

      expect(output).toContain('__safe_forOf');
      expect(output).toContain('for (const user of __safe_forOf');
    });

    it('should transform nested for-of loops', () => {
      const input = `
        for (const user of users) {
          for (const item of user.items) {
            console.log(item);
          }
        }
      `;

      const output = transformAgentScript(input, {
        wrapInMain: false,
        transformCallTool: false,
        transformLoops: true,
      });

      // Should have two __safe_forOf calls
      const matches = output.match(/__safe_forOf/g);
      expect(matches).toBeTruthy();
      expect(matches!.length).toBe(2);
    });
  });

  describe('Combined Transformations', () => {
    it('should apply all transformations together', () => {
      const input = `
        const users = await callTool('users:list', { limit: 100 });
        const results = [];

        for (const user of users.items) {
          const data = await callTool('users:getData', { id: user.id });
          if (data.active) {
            results.push({
              id: data.id,
              name: data.name,
              score: Math.round(data.score)
            });
          }
        }

        return results;
      `;

      const output = transformAgentScript(input, {
        wrapInMain: true,
        transformCallTool: true,
        transformLoops: true,
      });

      // Should be wrapped
      expect(output).toContain('async function __ag_main()');

      // callTool should be transformed (it's a global)
      expect(output).toContain('__safe_callTool');

      // Loops should be transformed
      expect(output).toContain('__safe_forOf');

      // Math should NOT be transformed (whitelisted)
      expect(output).toContain('Math.round');
      expect(output).not.toContain('__safe_Math');

      // Locally-declared variables should NOT be transformed
      // The transformer correctly skips locally-declared identifiers
      expect(output).not.toContain('__safe_users');
      expect(output).not.toContain('__safe_data');
      expect(output).not.toContain('__safe_results');

      // References to locals should be preserved
      expect(output).toContain('users.items');
      expect(output).toContain('data.active');
      expect(output).toContain('results.push');
    });

    it('should handle complex orchestration script', () => {
      const input = `
        const users = await callTool('users:list', {
          limit: 100,
          filter: { role: 'admin', active: true }
        });

        const aggregated = [];

        for (const user of users.items) {
          const invoices = await callTool('billing:listInvoices', {
            userId: user.id,
            status: 'unpaid'
          });

          if (invoices.items.length > 0) {
            const totalAmount = invoices.items.reduce((sum, inv) => sum + inv.amount, 0);
            aggregated.push({
              userId: user.id,
              userName: user.name,
              unpaidCount: invoices.items.length,
              totalAmount: Math.round(totalAmount * 100) / 100
            });
          }
        }

        return aggregated.sort((a, b) => b.totalAmount - a.totalAmount);
      `;

      const output = transformAgentScript(input);

      // All transformations should be applied
      expect(output).toContain('async function __ag_main()');
      expect(output).toContain('__safe_callTool');
      expect(output).toContain('__safe_forOf');
      expect(output).toContain('Math.round'); // Not transformed
    });
  });

  describe('Helper Functions', () => {
    describe('isWrappedInMain', () => {
      it('should detect wrapped code', () => {
        const wrapped = `
          async function __ag_main() {
            const data = await callTool('getData', {});
            return data;
          }
        `;

        expect(isWrappedInMain(wrapped)).toBe(true);
      });

      it('should detect non-wrapped code', () => {
        const notWrapped = `const data = await callTool('getData', {});`;

        expect(isWrappedInMain(notWrapped)).toBe(false);
      });

      it('should detect non-async function', () => {
        const notAsync = `
          function __ag_main() {
            return 42;
          }
        `;

        expect(isWrappedInMain(notAsync)).toBe(false);
      });

      it('should detect different function name', () => {
        const differentName = `
          async function myFunction() {
            return 42;
          }
        `;

        expect(isWrappedInMain(differentName)).toBe(false);
      });
    });

    describe('unwrapFromMain', () => {
      it('should unwrap code from __ag_main', () => {
        const wrapped = `
          async function __ag_main() {
            const data = await callTool('getData', {});
            return data;
          }
        `;

        const unwrapped = unwrapFromMain(wrapped);

        expect(unwrapped).toContain('const data = await callTool');
        expect(unwrapped).toContain('return data');
        expect(unwrapped).not.toContain('async function __ag_main');
      });

      it('should return unchanged if not wrapped', () => {
        const notWrapped = `const data = await callTool('getData', {});`;

        const result = unwrapFromMain(notWrapped);

        expect(result).toBe(notWrapped);
      });

      it('should handle invalid code gracefully', () => {
        const invalid = `this is not valid javascript {{{`;

        const result = unwrapFromMain(invalid);

        expect(result).toBe(invalid); // Returns unchanged
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty code', () => {
      // Empty code is valid and can be parsed - produces empty program
      const output = transformAgentScript('', {
        wrapInMain: false,
        transformCallTool: false,
        transformLoops: false,
      });

      // Should produce empty or minimal output
      expect(typeof output).toBe('string');
    });

    it('should handle only comments', () => {
      const input = `
        // This is a comment
        /* This is a block comment */
      `;

      const output = transformAgentScript(input, {
        wrapInMain: true,
        transformCallTool: false,
        transformLoops: false,
      });

      expect(output).toContain('async function __ag_main()');
    });

    it('should handle invalid syntax gracefully', () => {
      const invalid = `this is not valid javascript {{{`;

      expect(() => {
        transformAgentScript(invalid);
      }).toThrow('Failed to parse AgentScript code');
    });

    it('should preserve nested arrow functions', () => {
      const input = `
        const result = data.items
          .map(x => x.values.map(v => v * 2))
          .filter(arr => arr.length > 0)
          .reduce((acc, arr) => [...acc, ...arr], []);
      `;

      const output = transformAgentScript(input, {
        wrapInMain: false,
        transformCallTool: true,
        transformLoops: false,
      });

      // Should still have valid arrow functions
      expect(output).toContain('=>');
      // References should be transformed
      expect(output).toContain('__safe_data');
    });

    it('should handle destructuring - object pattern', () => {
      const input = `
        const { items, total } = await callTool('getData', {});
        const [first, ...rest] = items;
        return { items, total, first };
      `;

      const output = transformAgentScript(input, {
        wrapInMain: false,
        transformCallTool: true,
        transformLoops: false,
      });

      // callTool should be transformed (it's a global)
      expect(output).toContain('__safe_callTool');

      // Destructured variables should NOT be transformed (they are local declarations)
      expect(output).not.toContain('__safe_items');
      expect(output).not.toContain('__safe_total');
      expect(output).not.toContain('__safe_first');
      expect(output).not.toContain('__safe_rest');

      // References to destructured variables should be preserved
      expect(output).toContain('= items'); // Reference in array destructuring RHS
    });

    it('should handle destructuring - with defaults', () => {
      const input = `
        const { name = 'default', age = 18 } = user;
        return name + age;
      `;

      const output = transformAgentScript(input, {
        wrapInMain: false,
        transformCallTool: true,
        transformLoops: false,
      });

      // Destructured variables should NOT be transformed
      expect(output).not.toContain('__safe_name');
      expect(output).not.toContain('__safe_age');

      // user is not declared locally, so it should be transformed
      expect(output).toContain('__safe_user');
    });

    it('should handle destructuring - with aliases', () => {
      const input = `
        const { data: result, count: total } = await callTool('getData', {});
        return result + total;
      `;

      const output = transformAgentScript(input, {
        wrapInMain: false,
        transformCallTool: true,
        transformLoops: false,
      });

      // The aliases (result, total) are the local bindings, not data/count
      expect(output).not.toContain('__safe_result');
      expect(output).not.toContain('__safe_total');

      // callTool should be transformed
      expect(output).toContain('__safe_callTool');
    });

    it('should handle destructuring - nested', () => {
      const input = `
        const { user: { name, email }, meta: { timestamp } } = await callTool('getData', {});
        return name + email + timestamp;
      `;

      const output = transformAgentScript(input, {
        wrapInMain: false,
        transformCallTool: true,
        transformLoops: false,
      });

      // Nested destructured variables should NOT be transformed
      expect(output).not.toContain('__safe_name');
      expect(output).not.toContain('__safe_email');
      expect(output).not.toContain('__safe_timestamp');
    });

    it('should handle destructuring - rest patterns', () => {
      const input = `
        const { first, ...remaining } = await callTool('getData', {});
        const [head, ...tail] = items;
        return { first, remaining, head, tail };
      `;

      const output = transformAgentScript(input, {
        wrapInMain: false,
        transformCallTool: true,
        transformLoops: false,
      });

      // Rest pattern variables should NOT be transformed
      expect(output).not.toContain('__safe_first');
      expect(output).not.toContain('__safe_remaining');
      expect(output).not.toContain('__safe_head');
      expect(output).not.toContain('__safe_tail');

      // items is not declared, should be transformed
      expect(output).toContain('__safe_items');
    });

    it('should handle destructuring - function parameters', () => {
      const input = `
        const fn = ({ name, age }) => name + age;
        const fn2 = ([first, second]) => first + second;
        return fn({ name: 'test', age: 20 });
      `;

      const output = transformAgentScript(input, {
        wrapInMain: false,
        transformCallTool: true,
        transformLoops: false,
      });

      // Destructured function parameters should NOT be transformed
      expect(output).not.toContain('__safe_name');
      expect(output).not.toContain('__safe_age');
      expect(output).not.toContain('__safe_first');
      expect(output).not.toContain('__safe_second');
    });

    it('should handle destructuring - for-of loop', () => {
      const input = `
        const data = await callTool('getData', {});
        for (const { id, name } of data.items) {
          console.log(id, name);
        }
      `;

      const output = transformAgentScript(input, {
        wrapInMain: false,
        transformCallTool: true,
        transformLoops: true,
      });

      // Loop destructured variables should NOT be transformed
      expect(output).not.toContain('__safe_id');
      expect(output).not.toContain('__safe_name');

      // data should NOT be transformed (locally declared)
      expect(output).not.toContain('__safe_data');
    });

    describe('Security - Destructuring Attack Vectors', () => {
      it('should safely handle constructor destructuring from callTool', () => {
        // Attack vector: Try to extract constructor from callTool function
        const input = `
          const { constructor } = callTool;
          const fn = constructor('return this')();
        `;

        const output = transformAgentScript(input, {
          wrapInMain: false,
          transformCallTool: true,
          transformLoops: false,
        });

        // callTool should be transformed to __safe_callTool
        expect(output).toContain('__safe_callTool');

        // 'constructor' as a destructured variable is a local binding, not transformed
        // But this is safe because:
        // 1. The RHS (__safe_callTool) is the safe wrapper function
        // 2. Even if someone gets constructor from it, they get Function.prototype.constructor
        //    which cannot escape the sandbox if the sandbox is properly configured
        expect(output).not.toContain('__safe_constructor');

        // The key security is that callTool is transformed, so the attack
        // extracts constructor from the SAFE wrapper, not any dangerous global
      });

      it('should safely handle prototype destructuring', () => {
        const input = `
          const { prototype } = Object;
          const { __proto__ } = {};
        `;

        const output = transformAgentScript(input, {
          wrapInMain: false,
          transformCallTool: true,
          transformLoops: false,
        });

        // Object is whitelisted and should NOT be transformed
        expect(output).toContain('Object');
        expect(output).not.toContain('__safe_Object');

        // 'prototype' and '__proto__' as destructured variables are local bindings
        // This is safe because we're just extracting a reference, not executing code
      });

      it('should safely handle Function constructor attempt via destructuring', () => {
        const input = `
          const { constructor: Func } = (function(){});
          const evil = Func('return process')();
        `;

        const output = transformAgentScript(input, {
          wrapInMain: false,
          transformCallTool: true,
          transformLoops: false,
        });

        // Func is a local binding (alias for constructor), should NOT be transformed
        expect(output).not.toContain('__safe_Func');

        // The function expression is transformed
        // Note: This attack would be blocked by NoUserDefinedFunctionsRule in AgentScript preset
      });

      it('should transform unbound global references in destructuring RHS', () => {
        const input = `
          const { env } = process;
          const { constructor } = globalThis;
        `;

        const output = transformAgentScript(input, {
          wrapInMain: false,
          transformCallTool: true,
          transformLoops: false,
        });

        // process and globalThis are NOT in whitelist, should be transformed
        expect(output).toContain('__safe_process');
        expect(output).toContain('__safe_globalThis');

        // The destructured variables are local, not transformed
        expect(output).not.toContain('__safe_env');
      });

      it('should handle nested constructor extraction attempt', () => {
        const input = `
          const { constructor: { constructor: Func } } = callTool;
          const result = Func('return 1+1')();
        `;

        const output = transformAgentScript(input, {
          wrapInMain: false,
          transformCallTool: true,
          transformLoops: false,
        });

        // callTool should be transformed
        expect(output).toContain('__safe_callTool');

        // Func is a deeply nested local binding
        expect(output).not.toContain('__safe_Func');
      });
    });
  });
});
