import { JSAstValidator } from '../validator';
import { StaticCallTargetRule } from '../rules';

describe('StaticCallTargetRule', () => {
  describe('basic validation', () => {
    it('should accept static string literal arguments', async () => {
      const rule = new StaticCallTargetRule();
      const validator = new JSAstValidator([rule]);

      const result = await validator.validate('callTool("users:list", { limit: 10 });');
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should accept single-quoted string literals', async () => {
      const rule = new StaticCallTargetRule();
      const validator = new JSAstValidator([rule]);

      const result = await validator.validate("callTool('billing:invoice', {});");
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should accept template literals without expressions', async () => {
      const rule = new StaticCallTargetRule();
      const validator = new JSAstValidator([rule]);

      const result = await validator.validate('callTool(`users:list`, {});');
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should accept __safe_callTool by default', async () => {
      const rule = new StaticCallTargetRule();
      const validator = new JSAstValidator([rule]);

      const result = await validator.validate('__safe_callTool("users:list", {});');
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('rejection of dynamic arguments', () => {
    it('should reject variable references', async () => {
      const rule = new StaticCallTargetRule();
      const validator = new JSAstValidator([rule]);

      const result = await validator.validate(`
        const toolName = "users:list";
        callTool(toolName, {});
      `);
      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].code).toBe('DYNAMIC_CALL_TARGET');
      expect(result.issues[0].message).toContain('Variable references');
    });

    it('should reject string concatenation', async () => {
      const rule = new StaticCallTargetRule();
      const validator = new JSAstValidator([rule]);

      const result = await validator.validate(`
        const prefix = "users";
        callTool(prefix + ":list", {});
      `);
      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].code).toBe('DYNAMIC_CALL_TARGET');
      expect(result.issues[0].message).toContain('String concatenation');
    });

    it('should reject template literals with expressions', async () => {
      const rule = new StaticCallTargetRule();
      const validator = new JSAstValidator([rule]);

      const result = await validator.validate(`
        const id = "123";
        callTool(\`users:\${id}\`, {});
      `);
      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].code).toBe('DYNAMIC_CALL_TARGET');
      expect(result.issues[0].message).toContain('Template literals with embedded expressions');
    });

    it('should reject ternary/conditional expressions', async () => {
      const rule = new StaticCallTargetRule();
      const validator = new JSAstValidator([rule]);

      const result = await validator.validate(`
        const isAdmin = true;
        callTool(isAdmin ? "admin:list" : "users:list", {});
      `);
      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].code).toBe('DYNAMIC_CALL_TARGET');
      expect(result.issues[0].message).toContain('Conditional (ternary) expressions');
    });

    it('should reject function call results', async () => {
      const rule = new StaticCallTargetRule();
      const validator = new JSAstValidator([rule]);

      const result = await validator.validate(`
        callTool(getToolName(), {});
      `);
      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].code).toBe('DYNAMIC_CALL_TARGET');
      expect(result.issues[0].message).toContain('Function call results');
    });

    it('should reject property access expressions', async () => {
      const rule = new StaticCallTargetRule();
      const validator = new JSAstValidator([rule]);

      const result = await validator.validate(`
        const tools = { main: "users:list" };
        callTool(tools.main, {});
      `);
      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].code).toBe('DYNAMIC_CALL_TARGET');
      expect(result.issues[0].message).toContain('Property access');
    });

    it('should reject logical expressions', async () => {
      const rule = new StaticCallTargetRule();
      const validator = new JSAstValidator([rule]);

      const result = await validator.validate(`
        const name = null;
        callTool(name || "default:tool", {});
      `);
      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].code).toBe('DYNAMIC_CALL_TARGET');
    });

    it('should reject await expressions', async () => {
      const rule = new StaticCallTargetRule();
      const validator = new JSAstValidator([rule]);

      const result = await validator.validate(`
        async function test() {
          callTool(await getToolName(), {});
        }
      `);
      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].code).toBe('DYNAMIC_CALL_TARGET');
      expect(result.issues[0].message).toContain('Await expressions');
    });
  });

  describe('missing argument handling', () => {
    it('should report missing first argument', async () => {
      const rule = new StaticCallTargetRule();
      const validator = new JSAstValidator([rule]);

      const result = await validator.validate('callTool();');
      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].code).toBe('MISSING_CALL_TARGET');
    });
  });

  describe('tool name whitelist', () => {
    it('should accept whitelisted tool names', async () => {
      const rule = new StaticCallTargetRule({
        allowedToolNames: ['users:list', 'users:get'],
      });
      const validator = new JSAstValidator([rule]);

      const result = await validator.validate('callTool("users:list", {});');
      expect(result.valid).toBe(true);
    });

    it('should reject non-whitelisted tool names', async () => {
      const rule = new StaticCallTargetRule({
        allowedToolNames: ['users:list', 'users:get'],
      });
      const validator = new JSAstValidator([rule]);

      const result = await validator.validate('callTool("admin:delete", {});');
      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].code).toBe('UNKNOWN_TOOL_NAME');
      expect(result.issues[0].data?.['toolName']).toBe('admin:delete');
    });

    it('should support RegExp patterns in whitelist', async () => {
      const rule = new StaticCallTargetRule({
        allowedToolNames: [/^users:/, /^billing:/],
      });
      const validator = new JSAstValidator([rule]);

      const result1 = await validator.validate('callTool("users:list", {});');
      expect(result1.valid).toBe(true);

      const result2 = await validator.validate('callTool("billing:invoice", {});');
      expect(result2.valid).toBe(true);

      const result3 = await validator.validate('callTool("admin:delete", {});');
      expect(result3.valid).toBe(false);
      expect(result3.issues[0].code).toBe('UNKNOWN_TOOL_NAME');
    });

    it('should support mixed string and RegExp patterns', async () => {
      const rule = new StaticCallTargetRule({
        allowedToolNames: ['special:tool', /^users:/],
      });
      const validator = new JSAstValidator([rule]);

      const result1 = await validator.validate('callTool("special:tool", {});');
      expect(result1.valid).toBe(true);

      const result2 = await validator.validate('callTool("users:anything", {});');
      expect(result2.valid).toBe(true);
    });
  });

  describe('custom target functions', () => {
    it('should validate custom function names', async () => {
      const rule = new StaticCallTargetRule({
        targetFunctions: ['invokeTool', 'executeTool'],
      });
      const validator = new JSAstValidator([rule]);

      // Should validate invokeTool
      const result1 = await validator.validate(`
        const name = "test";
        invokeTool(name, {});
      `);
      expect(result1.valid).toBe(false);
      expect(result1.issues[0].code).toBe('DYNAMIC_CALL_TARGET');

      // Should NOT validate callTool (not in list)
      const result2 = await validator.validate(`
        const name = "test";
        callTool(name, {});
      `);
      expect(result2.valid).toBe(true);
    });
  });

  describe('custom argument position', () => {
    it('should validate non-first argument position', async () => {
      const rule = new StaticCallTargetRule({
        targetFunctions: ['dispatch'],
        argumentPosition: 1, // Validate second argument
      });
      const validator = new JSAstValidator([rule]);

      // Should pass - second arg is static
      const result1 = await validator.validate('dispatch(context, "action:name", {});');
      expect(result1.valid).toBe(true);

      // Should fail - second arg is dynamic
      const result2 = await validator.validate(`
        const action = "test";
        dispatch(context, action, {});
      `);
      expect(result2.valid).toBe(false);
      expect(result2.issues[0].code).toBe('DYNAMIC_CALL_TARGET');
    });
  });

  describe('member expression calls', () => {
    it('should validate method calls on objects', async () => {
      const rule = new StaticCallTargetRule();
      const validator = new JSAstValidator([rule]);

      // Should validate obj.callTool
      const result = await validator.validate(`
        const name = "test";
        obj.callTool(name, {});
      `);
      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('DYNAMIC_CALL_TARGET');
    });

    it('should pass member expression with static argument', async () => {
      const rule = new StaticCallTargetRule();
      const validator = new JSAstValidator([rule]);

      const result = await validator.validate('api.callTool("users:list", {});');
      expect(result.valid).toBe(true);
    });
  });

  describe('multiple calls in same code', () => {
    it('should validate all callTool invocations', async () => {
      const rule = new StaticCallTargetRule();
      const validator = new JSAstValidator([rule]);

      const result = await validator.validate(`
        const name = "dynamic";
        callTool("static:ok", {});
        callTool(name, {});
        callTool("another:static", {});
      `);
      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].code).toBe('DYNAMIC_CALL_TARGET');
    });

    it('should report all violations', async () => {
      const rule = new StaticCallTargetRule();
      const validator = new JSAstValidator([rule]);

      const result = await validator.validate(`
        const name1 = "a";
        const name2 = "b";
        callTool(name1, {});
        callTool(name2, {});
      `);
      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(2);
    });
  });

  describe('edge cases', () => {
    it('should handle empty string literals', async () => {
      const rule = new StaticCallTargetRule();
      const validator = new JSAstValidator([rule]);

      const result = await validator.validate('callTool("", {});');
      expect(result.valid).toBe(true); // Empty string is still a static literal
    });

    it('should handle string with special characters', async () => {
      const rule = new StaticCallTargetRule();
      const validator = new JSAstValidator([rule]);

      const result = await validator.validate('callTool("namespace:tool-name_v2", {});');
      expect(result.valid).toBe(true);
    });

    it('should handle nested function calls', async () => {
      const rule = new StaticCallTargetRule();
      const validator = new JSAstValidator([rule]);

      const result = await validator.validate(`
        async function test() {
          const result = await callTool("outer:tool", {
            data: await callTool("inner:tool", {})
          });
        }
      `);
      expect(result.valid).toBe(true);
    });

    it('should ignore non-target functions', async () => {
      const rule = new StaticCallTargetRule();
      const validator = new JSAstValidator([rule]);

      const result = await validator.validate(`
        const name = "dynamic";
        console.log(name);
        Math.max(name, 10);
        someOtherFunction(name);
      `);
      expect(result.valid).toBe(true);
    });
  });

  describe('location information', () => {
    it('should provide accurate source location', async () => {
      const rule = new StaticCallTargetRule();
      const validator = new JSAstValidator([rule]);

      const result = await validator.validate(`const name = "test";
callTool(name, {});`);
      expect(result.valid).toBe(false);
      expect(result.issues[0].location).toBeDefined();
      expect(result.issues[0].location?.line).toBe(2);
    });
  });
});
