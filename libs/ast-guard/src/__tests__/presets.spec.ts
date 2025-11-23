import { JSAstValidator } from '../validator';
import {
  PresetLevel,
  Presets,
  createPreset,
  createStrictPreset,
  createSecurePreset,
  createStandardPreset,
  createPermissivePreset,
} from '../presets';

describe('Presets', () => {
  describe('STRICT Preset', () => {
    it('should block all eval constructs', async () => {
      const rules = createStrictPreset();
      const validator = new JSAstValidator(rules);

      const result = await validator.validate('eval("test")');
      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.code === 'NO_EVAL' || issue.code === 'DISALLOWED_IDENTIFIER')).toBe(
        true,
      );
    });

    it('should block all dangerous identifiers', async () => {
      const rules = createStrictPreset();
      const validator = new JSAstValidator(rules);

      const testCases = [
        'const x = process;',
        'const y = require;',
        'const z = global;',
        'const a = __dirname;',
        'const b = constructor;',
        'const c = __proto__;',
      ];

      for (const code of testCases) {
        const result = await validator.validate(code, {
          rules: { 'disallowed-identifier': true },
        });
        expect(result.valid).toBe(false);
      }
    });

    it('should block all loops by default', async () => {
      const rules = createStrictPreset();
      const validator = new JSAstValidator(rules);

      const code = `
        for (let i = 0; i < 10; i++) {}
        while (true) {}
        do {} while (false);
        for (const x of [1, 2]) {}
        for (const x in {}) {}
      `;

      const result = await validator.validate(code, {
        rules: { 'forbidden-loop': true },
      });

      expect(result.valid).toBe(false);
      expect(result.issues.filter((issue) => issue.code === 'FORBIDDEN_LOOP').length).toBe(5);
    });

    it('should allow specific loops when configured', async () => {
      const rules = createStrictPreset({
        allowedLoops: { allowFor: true, allowForOf: true },
      });
      const validator = new JSAstValidator(rules);

      const code = `
        for (let i = 0; i < 10; i++) {}
        for (const x of [1, 2]) {}
      `;

      const result = await validator.validate(code, {
        rules: { 'forbidden-loop': true },
      });

      expect(result.valid).toBe(true);
    });

    it('should block async/await by default', async () => {
      const rules = createStrictPreset();
      const validator = new JSAstValidator(rules);

      const result = await validator.validate('async function test() { await Promise.resolve(); }', {
        rules: { 'no-async': true },
      });

      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.code === 'NO_ASYNC')).toBe(true);
    });

    it('should enforce required function calls', async () => {
      const rules = createStrictPreset({
        requiredFunctions: ['callTool'],
      });
      const validator = new JSAstValidator(rules);

      const result = await validator.validate('const x = 1;', {
        rules: { 'required-function-call': true },
      });

      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('REQUIRED_FUNCTION_NOT_CALLED');
    });

    it('should validate function arguments', async () => {
      const rules = createStrictPreset({
        requiredFunctions: ['callTool'],
        functionArgumentRules: {
          callTool: { minArgs: 2, expectedTypes: ['string', 'object'] },
        },
      });
      const validator = new JSAstValidator(rules);

      const result = await validator.validate('callTool("test");', {
        rules: { 'call-argument-validation': true },
      });

      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('INVALID_ARGUMENT_COUNT');
    });

    it('should accept additional disallowed identifiers', async () => {
      const rules = createStrictPreset({
        additionalDisallowedIdentifiers: ['window', 'document'],
      });
      const validator = new JSAstValidator(rules);

      const result = await validator.validate('const w = window;', {
        rules: { 'disallowed-identifier': true },
      });

      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.data?.['identifier'] === 'window')).toBe(true);
    });
  });

  describe('SECURE Preset', () => {
    it('should block eval constructs', async () => {
      const rules = createSecurePreset();
      const validator = new JSAstValidator(rules);

      const result = await validator.validate('eval("test")');
      expect(result.valid).toBe(false);
    });

    it('should block dangerous identifiers', async () => {
      const rules = createSecurePreset();
      const validator = new JSAstValidator(rules);

      const result = await validator.validate('const x = process;', {
        rules: { 'disallowed-identifier': true },
      });

      expect(result.valid).toBe(false);
    });

    it('should allow for and for-of loops by default', async () => {
      const rules = createSecurePreset();
      const validator = new JSAstValidator(rules);

      const code = `
        for (let i = 0; i < 10; i++) {}
        for (const x of [1, 2]) {}
      `;

      const result = await validator.validate(code, {
        rules: { 'forbidden-loop': true },
      });

      expect(result.valid).toBe(true);
    });

    it('should block while and do-while loops', async () => {
      const rules = createSecurePreset();
      const validator = new JSAstValidator(rules);

      const code = `
        while (true) {}
        do {} while (false);
      `;

      const result = await validator.validate(code, {
        rules: { 'forbidden-loop': true },
      });

      expect(result.valid).toBe(false);
      expect(result.issues.filter((issue) => issue.code === 'FORBIDDEN_LOOP').length).toBe(2);
    });

    it('should block async functions but allow await by default', async () => {
      const rules = createSecurePreset();
      const validator = new JSAstValidator(rules);

      // Should fail on async function
      const asyncResult = await validator.validate('async function test() {}', {
        rules: { 'no-async': true },
      });
      expect(asyncResult.valid).toBe(false);

      // Note: await without async function context would be a syntax error
      // so we can't test "allow await" in isolation
    });

    it('should not block constructor/prototype by default', async () => {
      const rules = createSecurePreset();
      const validator = new JSAstValidator(rules);

      // constructor and __proto__ are not in the disallowed list for secure
      const result = await validator.validate('const x = constructor;', {
        rules: { 'disallowed-identifier': true },
      });

      // This should pass because secure doesn't block constructor
      expect(result.valid).toBe(true);
    });
  });

  describe('STANDARD Preset', () => {
    it('should block eval constructs', async () => {
      const rules = createStandardPreset();
      const validator = new JSAstValidator(rules);

      const result = await validator.validate('eval("test")');
      expect(result.valid).toBe(false);
    });

    it('should block critical dangerous identifiers only', async () => {
      const rules = createStandardPreset();
      const validator = new JSAstValidator(rules);

      // Should block
      const blockResult = await validator.validate('const x = process;', {
        rules: { 'disallowed-identifier': true },
      });
      expect(blockResult.valid).toBe(false);

      // Should allow (not in standard's disallowed list)
      const allowResult = await validator.validate('const x = global;', {
        rules: { 'disallowed-identifier': true },
      });
      expect(allowResult.valid).toBe(true);
    });

    it('should allow most loops except while/do-while', async () => {
      const rules = createStandardPreset();
      const validator = new JSAstValidator(rules);

      const allowedCode = `
        for (let i = 0; i < 10; i++) {}
        for (const x of [1, 2]) {}
        for (const x in {}) {}
      `;

      const allowedResult = await validator.validate(allowedCode, {
        rules: { 'forbidden-loop': true },
      });
      expect(allowedResult.valid).toBe(true);

      const blockedCode = `
        while (true) {}
        do {} while (false);
      `;

      const blockedResult = await validator.validate(blockedCode, {
        rules: { 'forbidden-loop': true },
      });
      expect(blockedResult.valid).toBe(false);
    });

    it('should allow async/await by default', async () => {
      const rules = createStandardPreset();
      const validator = new JSAstValidator(rules);

      const result = await validator.validate('async function test() { await Promise.resolve(); }', {
        rules: { 'no-async': true },
      });

      expect(result.valid).toBe(true);
    });

    it('should allow legitimate code patterns', async () => {
      const rules = createStandardPreset({
        requiredFunctions: ['callTool'],
      });
      const validator = new JSAstValidator(rules);

      const code = `
        const config = { tool: "getData" };

        for (const item of [1, 2, 3]) {
          const result = item * 2;
          callTool(config.tool, { value: result });
        }
      `;

      const result = await validator.validate(code, {
        rules: { 'required-function-call': true, 'forbidden-loop': true, 'no-eval': true },
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('PERMISSIVE Preset', () => {
    it('should only block eval by default', async () => {
      const rules = createPermissivePreset();
      const validator = new JSAstValidator(rules);

      const result = await validator.validate('eval("test")');
      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('NO_EVAL');
    });

    it('should allow all identifiers by default', async () => {
      const rules = createPermissivePreset();
      const validator = new JSAstValidator(rules);

      const code = `
        const p = process;
        const r = require;
        const g = global;
      `;

      const result = await validator.validate(code, {
        rules: { 'disallowed-identifier': true },
      });

      // No DisallowedIdentifierRule added by default in permissive
      expect(result.valid).toBe(true);
    });

    it('should allow all loops', async () => {
      const rules = createPermissivePreset();
      const validator = new JSAstValidator(rules);

      const code = `
        for (let i = 0; i < 10; i++) {}
        while (true) {}
        do {} while (false);
        for (const x of [1, 2]) {}
        for (const x in {}) {}
      `;

      const result = await validator.validate(code, {
        rules: { 'forbidden-loop': true },
      });

      // No ForbiddenLoopRule added in permissive
      expect(result.valid).toBe(true);
    });

    it('should allow async/await', async () => {
      const rules = createPermissivePreset();
      const validator = new JSAstValidator(rules);

      const result = await validator.validate('async function test() { await Promise.resolve(); }', {
        rules: { 'no-async': true },
      });

      // No NoAsyncRule added in permissive
      expect(result.valid).toBe(true);
    });

    it('should still detect unreachable code', async () => {
      const rules = createPermissivePreset();
      const validator = new JSAstValidator(rules);

      const result = await validator.validate(`
        function test() {
          return 1;
          const unreachable = 2;
        }
      `);

      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0].code).toBe('UNREACHABLE_CODE');
    });

    it('should accept additional disallowed identifiers', async () => {
      const rules = createPermissivePreset({
        additionalDisallowedIdentifiers: ['dangerousFunc'],
      });
      const validator = new JSAstValidator(rules);

      const result = await validator.validate('const x = dangerousFunc;', {
        rules: { 'disallowed-identifier': true },
      });

      expect(result.valid).toBe(false);
    });

    it('should only enforce required functions if specified', async () => {
      const rules = createPermissivePreset({
        requiredFunctions: ['callTool'],
      });
      const validator = new JSAstValidator(rules);

      const failResult = await validator.validate('const x = 1;', {
        rules: { 'required-function-call': true },
      });

      expect(failResult.valid).toBe(false);
      expect(failResult.issues[0].code).toBe('REQUIRED_FUNCTION_NOT_CALLED');

      const passResult = await validator.validate('callTool("test", {});', {
        rules: { 'required-function-call': true },
      });

      expect(passResult.valid).toBe(true);
    });

    it('should only enforce argument validation if specified', async () => {
      const rules = createPermissivePreset({
        functionArgumentRules: {
          callTool: { minArgs: 2 },
        },
      });
      const validator = new JSAstValidator(rules);

      const result = await validator.validate('callTool("test");', {
        rules: { 'call-argument-validation': true },
      });

      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('INVALID_ARGUMENT_COUNT');
    });
  });

  describe('createPreset() function', () => {
    it('should create strict preset', () => {
      const rules = createPreset(PresetLevel.STRICT);
      expect(rules.length).toBeGreaterThan(0);
      expect(rules.some((rule) => rule.name === 'no-eval')).toBe(true);
    });

    it('should create secure preset', () => {
      const rules = createPreset(PresetLevel.SECURE);
      expect(rules.length).toBeGreaterThan(0);
      expect(rules.some((rule) => rule.name === 'no-eval')).toBe(true);
    });

    it('should create standard preset', () => {
      const rules = createPreset(PresetLevel.STANDARD);
      expect(rules.length).toBeGreaterThan(0);
      expect(rules.some((rule) => rule.name === 'no-eval')).toBe(true);
    });

    it('should create permissive preset', () => {
      const rules = createPreset(PresetLevel.PERMISSIVE);
      expect(rules.length).toBeGreaterThan(0);
      expect(rules.some((rule) => rule.name === 'no-eval')).toBe(true);
    });

    it('should pass options to preset', () => {
      const rules = createPreset(PresetLevel.STRICT, {
        requiredFunctions: ['callTool'],
      });
      expect(rules.some((rule) => rule.name === 'required-function-call')).toBe(true);
    });

    it('should throw on unknown preset level', () => {
      expect(() => createPreset('unknown' as any)).toThrow('Unknown preset level');
    });
  });

  describe('Presets object', () => {
    it('should provide access to all preset functions', () => {
      expect(Presets.strict).toBe(createStrictPreset);
      expect(Presets.secure).toBe(createSecurePreset);
      expect(Presets.standard).toBe(createStandardPreset);
      expect(Presets.permissive).toBe(createPermissivePreset);
      expect(Presets.create).toBe(createPreset);
    });

    it('should create rules using Presets object', () => {
      const rules = Presets.strict();
      expect(rules.length).toBeGreaterThan(0);
    });
  });

  describe('Real-world usage scenarios', () => {
    it('should work with strict preset for untrusted code', async () => {
      const rules = Presets.strict({
        requiredFunctions: ['callTool'],
        functionArgumentRules: {
          callTool: { minArgs: 2, expectedTypes: ['string', 'object'] },
        },
      });
      const validator = new JSAstValidator(rules);

      // Malicious code should fail
      const maliciousResult = await validator.validate(
        `
        eval("malicious");
        process.exit(1);
      `,
        {
          rules: {
            'no-eval': true,
            'disallowed-identifier': true,
          },
        },
      );

      expect(maliciousResult.valid).toBe(false);

      // Valid code should pass
      const validResult = await validator.validate('callTool("getData", { id: 123 });', {
        rules: {
          'no-eval': true,
          'disallowed-identifier': true,
          'required-function-call': true,
          'call-argument-validation': true,
        },
      });

      expect(validResult.valid).toBe(true);
    });

    it('should work with standard preset for trusted code', async () => {
      const rules = Presets.standard({
        requiredFunctions: ['callTool'],
      });
      const validator = new JSAstValidator(rules);

      const code = `
        const data = [1, 2, 3, 4, 5];

        for (const item of data) {
          const processed = item * 2;
          callTool("sendData", { value: processed });
        }
      `;

      const result = await validator.validate(code, {
        rules: {
          'no-eval': true,
          'disallowed-identifier': true,
          'forbidden-loop': true,
          'required-function-call': true,
        },
      });

      expect(result.valid).toBe(true);
    });

    it('should allow customization on top of presets', async () => {
      const rules = Presets.secure({
        allowedLoops: { allowWhile: true }, // Override: allow while loops
        additionalDisallowedIdentifiers: ['window', 'document'], // Add custom identifiers
        requiredFunctions: ['callTool'],
        maxFunctionCalls: 10,
      });
      const validator = new JSAstValidator(rules);

      // While loop should now be allowed
      const whileResult = await validator.validate(
        `
        let i = 0;
        while (i < 5) { i++; }
        callTool("test", {});
      `,
        {
          rules: { 'forbidden-loop': true, 'required-function-call': true },
        },
      );

      expect(whileResult.valid).toBe(true);

      // Custom identifier should be blocked
      const customIdResult = await validator.validate('const w = window;', {
        rules: { 'disallowed-identifier': true },
      });

      expect(customIdResult.valid).toBe(false);
    });
  });
});
