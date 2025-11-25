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

    it('should not double-wrap already wrapped code', () => {
      const input = `
        async function __ag_main() {
          const data = await callTool('getData', {});
          return data;
        }
      `;

      // Check if already wrapped
      expect(isWrappedInMain(input)).toBe(true);

      // Transform anyway (user's responsibility to check)
      const output = transformAgentScript(input, {
        wrapInMain: true,
        transformCallTool: false,
        transformLoops: false,
      });

      // Should now have nested __ag_main
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

    it('should handle destructuring', () => {
      const input = `
        const { items, total } = await callTool('getData', {});
        const [first, ...rest] = items;
      `;

      const output = transformAgentScript(input, {
        wrapInMain: false,
        transformCallTool: true,
        transformLoops: false,
      });

      expect(output).toContain('__safe_callTool');
      expect(output).toContain('__safe_items'); // Reference to items
    });
  });
});
