/**
 * Tests for NoComputedDestructuringRule
 *
 * This rule blocks computed property names in destructuring patterns to prevent
 * runtime property name construction attacks that bypass static analysis.
 */

import { JSAstValidator } from '../validator';
import { NoComputedDestructuringRule } from '../rules/no-computed-destructuring.rule';
import { createAgentScriptPreset } from '../presets/agentscript.preset';

describe('NoComputedDestructuringRule', () => {
  describe('Security Attack Vectors', () => {
    it('should block string concatenation to construct "constructor"', async () => {
      const validator = new JSAstValidator([new NoComputedDestructuringRule()]);

      // This attack constructs 'constructor' at runtime to bypass static analysis
      const code = `const {['const'+'ructor']:Func} = callTool;`;

      const result = await validator.validate(code);

      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].code).toBe('NO_COMPUTED_DESTRUCTURING');
      expect(result.issues[0].message).toContain('Computed property names in destructuring are not allowed');
    });

    it('should block variable reference as property key', async () => {
      const validator = new JSAstValidator([new NoComputedDestructuringRule()]);

      // Attacker could set propName = 'constructor' at runtime
      const code = `
        const propName = 'constructor';
        const {[propName]:Func} = someFunction;
      `;

      const result = await validator.validate(code);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'NO_COMPUTED_DESTRUCTURING')).toBe(true);
    });

    it('should block template literal property keys', async () => {
      const validator = new JSAstValidator([new NoComputedDestructuringRule()]);

      const code = 'const {[`constructor`]:Func} = obj;';

      const result = await validator.validate(code);

      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('NO_COMPUTED_DESTRUCTURING');
    });

    it('should block function call as property key', async () => {
      const validator = new JSAstValidator([new NoComputedDestructuringRule()]);

      const code = `const {[getPropertyName()]:value} = obj;`;

      const result = await validator.validate(code);

      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('NO_COMPUTED_DESTRUCTURING');
    });

    it('should block member expression as property key', async () => {
      const validator = new JSAstValidator([new NoComputedDestructuringRule()]);

      const code = `const {[config.propertyName]:value} = obj;`;

      const result = await validator.validate(code);

      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('NO_COMPUTED_DESTRUCTURING');
    });

    it('should block __proto__ construction via concatenation', async () => {
      const validator = new JSAstValidator([new NoComputedDestructuringRule()]);

      const code = `const {['__pro'+'to__']:proto} = obj;`;

      const result = await validator.validate(code);

      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('NO_COMPUTED_DESTRUCTURING');
    });

    it('should block prototype construction via concatenation', async () => {
      const validator = new JSAstValidator([new NoComputedDestructuringRule()]);

      const code = `const {['proto'+'type']:proto} = Object;`;

      const result = await validator.validate(code);

      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('NO_COMPUTED_DESTRUCTURING');
    });

    it('should block nested computed destructuring', async () => {
      const validator = new JSAstValidator([new NoComputedDestructuringRule()]);

      const code = `const { inner: {[expr]:value} } = obj;`;

      const result = await validator.validate(code);

      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('NO_COMPUTED_DESTRUCTURING');
    });
  });

  describe('Valid Patterns (Should Allow)', () => {
    it('should allow static property names', async () => {
      const validator = new JSAstValidator([new NoComputedDestructuringRule()]);

      const code = `const { name, value } = obj;`;

      const result = await validator.validate(code);

      expect(result.valid).toBe(true);
    });

    it('should allow destructuring with aliases', async () => {
      const validator = new JSAstValidator([new NoComputedDestructuringRule()]);

      const code = `const { data: result, count: total } = response;`;

      const result = await validator.validate(code);

      expect(result.valid).toBe(true);
    });

    it('should allow nested destructuring with static keys', async () => {
      const validator = new JSAstValidator([new NoComputedDestructuringRule()]);

      const code = `const { user: { name, email } } = response;`;

      const result = await validator.validate(code);

      expect(result.valid).toBe(true);
    });

    it('should allow destructuring with defaults', async () => {
      const validator = new JSAstValidator([new NoComputedDestructuringRule()]);

      const code = `const { name = 'default', count = 0 } = obj;`;

      const result = await validator.validate(code);

      expect(result.valid).toBe(true);
    });

    it('should allow rest patterns', async () => {
      const validator = new JSAstValidator([new NoComputedDestructuringRule()]);

      const code = `const { first, ...rest } = obj;`;

      const result = await validator.validate(code);

      expect(result.valid).toBe(true);
    });

    it('should allow array destructuring', async () => {
      const validator = new JSAstValidator([new NoComputedDestructuringRule()]);

      const code = `const [first, second, ...rest] = arr;`;

      const result = await validator.validate(code);

      expect(result.valid).toBe(true);
    });

    it('should allow computed property access in object literals (not destructuring)', async () => {
      const validator = new JSAstValidator([new NoComputedDestructuringRule()]);

      // This is object creation, not destructuring
      const code = `const obj = { [expr]: value };`;

      const result = await validator.validate(code);

      expect(result.valid).toBe(true);
    });
  });

  describe('Integration with AgentScript Preset', () => {
    it('should block computed destructuring in full AgentScript validation', async () => {
      // Use full AgentScript preset - the validation should fail for multiple reasons
      // including the computed destructuring attack
      const validator = new JSAstValidator(
        createAgentScriptPreset({
          allowedGlobals: [
            'callTool',
            '__safe_callTool',
            'Math',
            'JSON',
            'Array',
            'Object',
            'String',
            'Number',
            'Date',
            'Func', // Allow Func as a local (will be declared)
          ],
        }),
      );

      // Wrap in async function __ag_main as AgentScript expects
      const code = `
        async function __ag_main() {
          const {['const'+'ructor']:Func} = callTool;
          return Func.name;
        }
      `;

      const result = await validator.validate(code);

      // Should fail validation
      expect(result.valid).toBe(false);

      // The computed destructuring rule should be among the violations
      // (there may be other violations too from the AgentScript preset)
      const issues = result.issues.map((i) => i.code);
      expect(issues).toContain('NO_COMPUTED_DESTRUCTURING');
    });

    it('should allow normal destructuring in AgentScript', async () => {
      const validator = new JSAstValidator(
        createAgentScriptPreset({
          allowedGlobals: [
            'callTool',
            '__safe_callTool',
            'Math',
            'JSON',
            'Array',
            'Object',
            'String',
            'Number',
            'Date',
            'result',
            'data',
            'items',
            'total',
            'name',
            'value',
            'length', // Allow the locals
          ],
        }),
      );

      // Wrap in async function __ag_main as AgentScript expects
      const code = `
        async function __ag_main() {
          const { items, total } = result;
          const { name, value } = data;
          return items.length + total;
        }
      `;

      const result = await validator.validate(code);

      // Should not have any computed destructuring issues
      const computedDestructuringIssues = result.issues.filter((i) => i.code === 'NO_COMPUTED_DESTRUCTURING');
      expect(computedDestructuringIssues).toHaveLength(0);
    });
  });

  describe('Error Message Quality', () => {
    it('should provide descriptive error for string concatenation', async () => {
      const validator = new JSAstValidator([new NoComputedDestructuringRule()]);

      const code = `const {['con'+'structor']:Func} = fn;`;

      const result = await validator.validate(code);

      expect(result.valid).toBe(false);
      expect(result.issues[0].message).toContain("'con' + 'structor'");
      expect(result.issues[0].message).toContain('bypass security checks');
    });

    it('should provide descriptive error for variable reference', async () => {
      const validator = new JSAstValidator([new NoComputedDestructuringRule()]);

      const code = `const {[propName]:value} = obj;`;

      const result = await validator.validate(code);

      expect(result.valid).toBe(false);
      expect(result.issues[0].message).toContain('propName');
    });

    it('should provide descriptive error for template literal', async () => {
      const validator = new JSAstValidator([new NoComputedDestructuringRule()]);

      const code = 'const {[`key`]:value} = obj;';

      const result = await validator.validate(code);

      expect(result.valid).toBe(false);
      expect(result.issues[0].message).toContain('`template`');
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple computed properties in same pattern', async () => {
      const validator = new JSAstValidator([new NoComputedDestructuringRule()]);

      const code = `const {[a]:x, [b]:y, [c]:z} = obj;`;

      const result = await validator.validate(code);

      expect(result.valid).toBe(false);
      // Should report 3 issues
      expect(result.issues.filter((i) => i.code === 'NO_COMPUTED_DESTRUCTURING')).toHaveLength(3);
    });

    it('should handle computed in nested pattern', async () => {
      const validator = new JSAstValidator([new NoComputedDestructuringRule()]);

      const code = `const { outer: { [inner]: value } } = obj;`;

      const result = await validator.validate(code);

      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('NO_COMPUTED_DESTRUCTURING');
    });

    it('should handle static string literal in brackets (edge case)', async () => {
      const validator = new JSAstValidator([new NoComputedDestructuringRule()]);

      // Even with static string, computed syntax should be blocked
      // because we can't always verify the string is safe
      const code = `const {['constructor']:Func} = fn;`;

      const result = await validator.validate(code);

      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('NO_COMPUTED_DESTRUCTURING');
    });
  });
});
