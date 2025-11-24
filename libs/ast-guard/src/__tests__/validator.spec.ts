import { JSAstValidator } from '../validator';
import { DisallowedIdentifierRule } from '../rules/disallowed-identifier.rule';
import { UnreachableCodeRule } from '../rules/unreachable-code.rule';
import { ValidationSeverity } from '../interfaces';

describe('JSAstValidator', () => {
  describe('constructor', () => {
    it('should create validator without rules', () => {
      const validator = new JSAstValidator();
      expect(validator.getRules()).toHaveLength(0);
    });

    it('should create validator with rules', () => {
      const rule = new DisallowedIdentifierRule({ disallowed: ['eval'] });
      const validator = new JSAstValidator([rule]);
      expect(validator.getRules()).toHaveLength(1);
    });
  });

  describe('registerRule', () => {
    it('should register a rule', () => {
      const validator = new JSAstValidator();
      const rule = new DisallowedIdentifierRule({ disallowed: ['eval'] });
      validator.registerRule(rule);
      expect(validator.getRules()).toHaveLength(1);
      expect(validator.getRule('disallowed-identifier')).toBe(rule);
    });

    it('should throw error when registering duplicate rule', () => {
      const validator = new JSAstValidator();
      const rule = new DisallowedIdentifierRule({ disallowed: ['eval'] });
      validator.registerRule(rule);
      expect(() => validator.registerRule(rule)).toThrow('already registered');
    });
  });

  describe('unregisterRule', () => {
    it('should unregister an existing rule', () => {
      const validator = new JSAstValidator();
      const rule = new DisallowedIdentifierRule({ disallowed: ['eval'] });
      validator.registerRule(rule);
      expect(validator.getRules()).toHaveLength(1);

      const result = validator.unregisterRule('disallowed-identifier');
      expect(result).toBe(true);
      expect(validator.getRules()).toHaveLength(0);
    });

    it('should return false when unregistering non-existent rule', () => {
      const validator = new JSAstValidator();
      const result = validator.unregisterRule('non-existent-rule');
      expect(result).toBe(false);
    });
  });

  describe('getRule', () => {
    it('should return undefined for non-existent rule', () => {
      const validator = new JSAstValidator();
      const result = validator.getRule('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('validate', () => {
    it('should validate valid code', async () => {
      const validator = new JSAstValidator();
      const result = await validator.validate('const x = 1;');
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.ast).toBeDefined();
    });

    it('should detect parse errors', async () => {
      const validator = new JSAstValidator();
      const result = await validator.validate('const x = ;');
      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].code).toBe('PARSE_ERROR');
      expect(result.parseError).toBeDefined();
    });

    it('should throw error for empty source', async () => {
      const validator = new JSAstValidator();
      await expect(validator.validate('')).rejects.toThrow('Source cannot be empty');
    });

    it('should throw error for non-string source', async () => {
      const validator = new JSAstValidator();
      await expect(validator.validate(null as any)).rejects.toThrow('Source must be a string');
    });

    it('should run enabled rules', async () => {
      const rule = new DisallowedIdentifierRule({ disallowed: ['eval'] });
      const validator = new JSAstValidator([rule]);
      const result = await validator.validate('eval("x")');
      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].code).toBe('DISALLOWED_IDENTIFIER');
    });

    it('should respect rule configuration', async () => {
      const rule = new DisallowedIdentifierRule({ disallowed: ['eval'] });
      const validator = new JSAstValidator([rule]);

      // Disable rule
      const result = await validator.validate('eval("x")', {
        rules: {
          'disallowed-identifier': false,
        },
      });
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should stop on first error when configured', async () => {
      const rule = new DisallowedIdentifierRule({ disallowed: ['eval', 'Function'] });
      const validator = new JSAstValidator([rule]);

      const result = await validator.validate('eval("x"); Function("y");', {
        stopOnFirstError: true,
      });

      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
    });

    it('should respect max issues limit', async () => {
      const rule = new DisallowedIdentifierRule({ disallowed: ['eval'] });
      const validator = new JSAstValidator([rule]);

      const result = await validator.validate('eval("x"); eval("y"); eval("z");', {
        maxIssues: 2,
      });

      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeLessThanOrEqual(2);
    });
  });

  describe('getStats', () => {
    it('should calculate stats correctly', async () => {
      const validator = new JSAstValidator([
        new DisallowedIdentifierRule({ disallowed: ['eval'] }),
        new UnreachableCodeRule(),
      ]);

      const result = await validator.validate(`
        eval("x");
        function test() {
          return 1;
          const unreachable = 2;
        }
      `);

      const stats = validator.getStats(result, 100);
      expect(stats.totalIssues).toBeGreaterThan(0);
      expect(stats.errors).toBeGreaterThan(0);
      expect(stats.durationMs).toBe(100);
    });
  });
});
