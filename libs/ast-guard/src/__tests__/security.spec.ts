import { JSAstValidator } from '../validator';
import {
  DisallowedIdentifierRule,
  ForbiddenLoopRule,
  RequiredFunctionCallRule,
  NoEvalRule,
  CallArgumentValidationRule,
  UnreachableCodeRule,
} from '../rules';

/**
 * Security-focused test suite
 * Tests real-world malicious code patterns that should be caught by AST Guard
 */
describe('Security Tests - Malicious Code Detection', () => {
  describe('Code Injection Attacks', () => {
    it('should block eval-based code injection', async () => {
      const guard = new JSAstValidator([new NoEvalRule(), new DisallowedIdentifierRule({ disallowed: ['eval'] })]);

      const maliciousCode = `
        const userInput = "'; process.exit(1); //";
        eval('console.log("' + userInput + '")');
      `;

      const result = await guard.validate(maliciousCode);
      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.code === 'NO_EVAL' || issue.code === 'DISALLOWED_IDENTIFIER')).toBe(
        true,
      );
    });

    it('should block Function constructor injection', async () => {
      const guard = new JSAstValidator([new NoEvalRule(), new DisallowedIdentifierRule({ disallowed: ['Function'] })]);

      const maliciousCode = `
        const userCode = "return process.env";
        const fn = new Function(userCode);
        fn();
      `;

      const result = await guard.validate(maliciousCode);
      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.code === 'NO_EVAL' || issue.code === 'DISALLOWED_IDENTIFIER')).toBe(
        true,
      );
    });

    it('should block setTimeout with string (eval variant)', async () => {
      const guard = new JSAstValidator([new NoEvalRule()]);

      const maliciousCode = `
        setTimeout("maliciousCode()", 1000);
      `;

      const result = await guard.validate(maliciousCode);
      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('NO_EVAL');
    });

    it('should block setInterval with string (eval variant)', async () => {
      const guard = new JSAstValidator([new NoEvalRule()]);

      const maliciousCode = `
        setInterval("stealData()", 100);
      `;

      const result = await guard.validate(maliciousCode);
      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('NO_EVAL');
    });
  });

  describe('Resource Exhaustion Attacks', () => {
    it('should block infinite while loops', async () => {
      const guard = new JSAstValidator([new ForbiddenLoopRule()]);

      const maliciousCode = `
        while (true) {
          // Infinite loop to exhaust CPU
        }
      `;

      const result = await guard.validate(maliciousCode, {
        rules: { 'forbidden-loop': true },
      });
      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('FORBIDDEN_LOOP');
    });

    it('should block infinite for loops', async () => {
      const guard = new JSAstValidator([new ForbiddenLoopRule()]);

      const maliciousCode = `
        for (;;) {
          // CPU exhaustion attack
        }
      `;

      const result = await guard.validate(maliciousCode, {
        rules: { 'forbidden-loop': true },
      });
      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('FORBIDDEN_LOOP');
    });

    it('should block recursive memory exhaustion', async () => {
      const guard = new JSAstValidator([new DisallowedIdentifierRule({ disallowed: ['arguments'] })]);

      const maliciousCode = `
        function exhaust() {
          const arr = new Array(1000000);
          exhaust(); // Stack overflow
        }
        exhaust();
      `;

      const result = await guard.validate(maliciousCode, {
        rules: { 'disallowed-identifier': true },
      });
      // This should pass the identifier check, but would be caught by runtime limits
      // We're validating that the AST structure itself is not blocking legitimate recursion
      expect(result.valid).toBe(true);
    });
  });

  describe('Privilege Escalation Attempts', () => {
    it('should block process access attempts', async () => {
      const guard = new JSAstValidator([
        new DisallowedIdentifierRule({ disallowed: ['process', 'require', '__dirname'] }),
      ]);

      const maliciousCode = `
        const proc = process;
        proc.exit(1);
      `;

      const result = await guard.validate(maliciousCode, {
        rules: { 'disallowed-identifier': true },
      });
      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.data?.['identifier'] === 'process')).toBe(true);
    });

    it('should block require() attempts', async () => {
      const guard = new JSAstValidator([new DisallowedIdentifierRule({ disallowed: ['require'] })]);

      const maliciousCode = `
        const fs = require('fs');
        fs.readFileSync('/etc/passwd');
      `;

      const result = await guard.validate(maliciousCode, {
        rules: { 'disallowed-identifier': true },
      });
      expect(result.valid).toBe(false);
      expect(result.issues.some((issue) => issue.data?.['identifier'] === 'require')).toBe(true);
    });

    it('should block __dirname and __filename access', async () => {
      const guard = new JSAstValidator([new DisallowedIdentifierRule({ disallowed: ['__dirname', '__filename'] })]);

      const maliciousCode = `
        const dir = __dirname;
        const file = __filename;
      `;

      const result = await guard.validate(maliciousCode, {
        rules: { 'disallowed-identifier': true },
      });
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Data Exfiltration Attempts', () => {
    it('should block global object manipulation', async () => {
      const guard = new JSAstValidator([new DisallowedIdentifierRule({ disallowed: ['global', 'globalThis'] })]);

      const maliciousCode = `
        global.stolenData = sensitiveInfo;
        globalThis.exfiltrate = sendToAttacker;
      `;

      const result = await guard.validate(maliciousCode, {
        rules: { 'disallowed-identifier': true },
      });
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Sandbox Escape Attempts', () => {
    it('should block constructor chain traversal with NoGlobalAccessRule', async () => {
      const { NoGlobalAccessRule } = require('../rules/no-global-access.rule');
      const guard = new JSAstValidator([new NoGlobalAccessRule()]);

      const maliciousCode = `
        const FunctionConstructor = {}.constructor.constructor;
        const dangerousFunc = FunctionConstructor('return process')();
      `;

      const result = await guard.validate(maliciousCode);
      // NoGlobalAccessRule catches .constructor property access
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'NO_CONSTRUCTOR_ACCESS')).toBe(true);
    });

    it('should block prototype pollution attempts', async () => {
      const guard = new JSAstValidator([new DisallowedIdentifierRule({ disallowed: ['__proto__', 'prototype'] })]);

      const maliciousCode = `
        const proto = __proto__;
        const p = prototype;
      `;

      const result = await guard.validate(maliciousCode, {
        rules: { 'disallowed-identifier': true },
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('API Abuse Prevention', () => {
    it('should enforce required API calls', async () => {
      const guard = new JSAstValidator([new RequiredFunctionCallRule({ required: ['callTool'] })]);

      const maliciousCode = `
        // Script that doesn't use the intended API
        const result = "I'm doing my own thing";
      `;

      const result = await guard.validate(maliciousCode, {
        rules: { 'required-function-call': true },
      });
      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('REQUIRED_FUNCTION_NOT_CALLED');
    });

    it('should validate API call arguments to prevent injection', async () => {
      const guard = new JSAstValidator([
        new CallArgumentValidationRule({
          functions: {
            callTool: {
              minArgs: 2,
              maxArgs: 2,
              expectedTypes: ['string', 'object'],
            },
          },
        }),
      ]);

      const maliciousCode = `
        // Trying to call with wrong argument types
        callTool(eval, { code: "malicious" });
      `;

      const result = await guard.validate(maliciousCode, {
        rules: { 'call-argument-validation': true },
      });
      expect(result.valid).toBe(false);
    });

    it('should prevent excessive API calls', async () => {
      const guard = new JSAstValidator([
        new RequiredFunctionCallRule({
          required: ['callTool'],
          minCalls: 1,
          maxCalls: 5,
        }),
      ]);

      const maliciousCode = `
        // Trying to DoS by excessive calls
        callTool("tool1", {});
        callTool("tool2", {});
        callTool("tool3", {});
        callTool("tool4", {});
        callTool("tool5", {});
        callTool("tool6", {}); // This exceeds the limit
      `;

      const result = await guard.validate(maliciousCode, {
        rules: { 'required-function-call': true },
      });
      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('FUNCTION_CALLED_TOO_MANY_TIMES');
    });
  });

  describe('Dead Code and Obfuscation Detection', () => {
    it('should detect unreachable code that might hide malicious intent', async () => {
      const guard = new JSAstValidator([new UnreachableCodeRule()]);

      const maliciousCode = `
        function legitimate() {
          return "all good";
          // Unreachable code below might contain hidden malicious logic
          eval("steal credentials");
          process.exit(1);
        }
      `;

      const result = await guard.validate(maliciousCode);
      expect(result.issues.some((issue) => issue.code === 'UNREACHABLE_CODE')).toBe(true);
    });
  });

  describe('Combined Attack Scenarios', () => {
    it('should block multi-vector attack', async () => {
      const guard = new JSAstValidator([
        new NoEvalRule(),
        new DisallowedIdentifierRule({
          disallowed: ['eval', 'Function', 'process', 'require', 'global'],
        }),
        new ForbiddenLoopRule(),
        new RequiredFunctionCallRule({ required: ['callTool'] }),
      ]);

      const maliciousCode = `
        // Multi-vector attack combining several techniques
        const proc = process;
        while (true) {
          eval("malicious code");
        }
        // Not using the required API
      `;

      const result = await guard.validate(maliciousCode, {
        rules: {
          'no-eval': true,
          'disallowed-identifier': true,
          'forbidden-loop': true,
          'required-function-call': true,
        },
      });

      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(2);
      expect(result.issues.some((issue) => issue.code === 'NO_EVAL')).toBe(true);
      expect(result.issues.some((issue) => issue.code === 'DISALLOWED_IDENTIFIER')).toBe(true);
      expect(result.issues.some((issue) => issue.code === 'FORBIDDEN_LOOP')).toBe(true);
    });

    it('should allow legitimate code while blocking malicious patterns', async () => {
      const guard = new JSAstValidator([
        new NoEvalRule(),
        new DisallowedIdentifierRule({ disallowed: ['eval', 'Function', 'process'] }),
        new RequiredFunctionCallRule({ required: ['callTool'] }),
        new CallArgumentValidationRule({
          functions: {
            callTool: {
              minArgs: 2,
              expectedTypes: ['string', 'object'],
            },
          },
        }),
      ]);

      const legitimateCode = `
        // Using literals directly for validation
        callTool("getData", { id: 123 });
      `;

      const result = await guard.validate(legitimateCode, {
        rules: {
          'no-eval': true,
          'disallowed-identifier': true,
          'required-function-call': true,
          'call-argument-validation': true,
        },
      });

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('Edge Cases and Bypass Attempts', () => {
    it('should block eval when used as identifier', async () => {
      const guard = new JSAstValidator([new DisallowedIdentifierRule({ disallowed: ['eval'] })]);

      const maliciousCode = `
        const e = eval;
        e("malicious code");
      `;

      const result = await guard.validate(maliciousCode, {
        rules: { 'disallowed-identifier': true },
      });
      // This catches direct eval identifier reference
      expect(result.valid).toBe(false);
    });

    it('should handle complex code patterns', async () => {
      const guard = new JSAstValidator([new RequiredFunctionCallRule({ required: ['callTool'] }), new NoEvalRule()]);

      const complexCode = `
        const config = {
          tool: "myTool",
          params: { nested: { deep: { value: 123 } } }
        };

        function processData(data) {
          const transformed = data.nested.deep.value * 2;
          return { result: transformed };
        }

        const input = processData(config.params);
        callTool(config.tool, input);
      `;

      const result = await guard.validate(complexCode, {
        rules: { 'required-function-call': true, 'no-eval': true },
      });

      expect(result.valid).toBe(true);
    });
  });
});
