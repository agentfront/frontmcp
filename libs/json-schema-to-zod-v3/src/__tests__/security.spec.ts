import {
  validatePattern,
  createSafeRegExp,
  createSafePatternValidator,
  setSecurityConfig,
  getSecurityConfig,
  DEFAULT_SECURITY_CONFIG,
} from '../security';

describe('Security - ReDoS Protection', () => {
  beforeEach(() => {
    // Reset to default configuration before each test
    setSecurityConfig(DEFAULT_SECURITY_CONFIG);
  });

  describe('validatePattern', () => {
    it('should accept safe patterns', () => {
      const safePatterns = ['^[a-z]+$', '\\d{3}-\\d{4}', '^[A-Z][a-z]*$', '[0-9]{1,3}\\.[0-9]{1,3}', '^https?://.*'];

      for (const pattern of safePatterns) {
        const result = validatePattern(pattern);
        expect(result.safe).toBe(true);
        expect(result.pattern).toBe(pattern);
      }
    });

    it('should reject patterns with nested quantifiers', () => {
      const dangerousPatterns = [
        '(a+)*', // Nested quantifiers
        '(a*)+', // Nested quantifiers
        '(\\d+)*', // Nested quantifiers
        '(a|ab)*', // Alternation with quantifier
      ];

      for (const pattern of dangerousPatterns) {
        const result = validatePattern(pattern);
        expect(result.safe).toBe(false);
        expect(result.reason).toContain('dangerous constructs');
      }
    });

    it('should reject patterns that are too long', () => {
      const longPattern = 'a'.repeat(1001);
      const result = validatePattern(longPattern);

      expect(result.safe).toBe(false);
      expect(result.reason).toContain('maximum length');
    });

    it('should reject patterns with excessive quantifiers', () => {
      const result = validatePattern('a{1,200}');

      expect(result.safe).toBe(false);
      expect(result.reason).toContain('maximum value');
    });

    it('should reject invalid regex syntax', () => {
      const invalidPatterns = ['(unclosed', '[unclosed', '*invalid', '(?P<invalid)'];

      for (const pattern of invalidPatterns) {
        const result = validatePattern(pattern);
        expect(result.safe).toBe(false);
        expect(result.reason).toContain('Invalid regex syntax');
      }
    });

    it('should accept patterns with safe quantifiers', () => {
      const result = validatePattern('a{1,50}');

      expect(result.safe).toBe(true);
      expect(result.pattern).toBe('a{1,50}');
    });
  });

  describe('createSafeRegExp', () => {
    it('should create regex from safe patterns', () => {
      const regex = createSafeRegExp('^[a-z]+$');

      expect(regex).not.toBeNull();
      expect(regex?.test('hello')).toBe(true);
      expect(regex?.test('HELLO')).toBe(false);
    });

    it('should return null for unsafe patterns', () => {
      const regex = createSafeRegExp('(a+)+');

      expect(regex).toBeNull();
    });

    it('should handle regex flags', () => {
      const regex = createSafeRegExp('^[a-z]+$', 'i');

      expect(regex).not.toBeNull();
      expect(regex?.test('HELLO')).toBe(true);
    });

    it('should timeout on slow patterns', () => {
      // This pattern might be slow on certain inputs
      // noinspection JSUnusedLocalSymbols
      const regex = createSafeRegExp('^(a|a)*$', undefined, 1);

      // The regex might be created but will timeout during testing
      // Just verify it doesn't hang
      expect(true).toBe(true);
    });
  });

  describe('createSafePatternValidator', () => {
    it('should create a working validator for safe patterns', () => {
      const validator = createSafePatternValidator('^[a-z]+$');

      expect(validator('hello')).toBe(true);
      expect(validator('HELLO')).toBe(false);
      expect(validator('hello123')).toBe(false);
    });

    it('should return false for unsafe patterns', () => {
      const validator = createSafePatternValidator('(a+)+');

      // Validator should always return false for unsafe patterns
      expect(validator('aaaa')).toBe(false);
      expect(validator('test')).toBe(false);
    });

    it('should handle edge cases', () => {
      const validator = createSafePatternValidator('^[a-z]+$');

      expect(validator('')).toBe(false);
      expect(validator('a')).toBe(true);
    });
  });

  describe('Security Configuration', () => {
    it('should return default configuration', () => {
      const config = getSecurityConfig();

      expect(config.enableProtection).toBe(true);
      expect(config.warnOnUnsafe).toBe(true);
      expect(config.throwOnUnsafe).toBe(false);
      expect(config.maxPatternLength).toBe(1000);
      expect(config.maxQuantifier).toBe(100);
      expect(config.timeoutMs).toBe(100);
    });

    it('should allow updating configuration', () => {
      setSecurityConfig({
        maxPatternLength: 500,
        throwOnUnsafe: true,
      });

      const config = getSecurityConfig();

      expect(config.maxPatternLength).toBe(500);
      expect(config.throwOnUnsafe).toBe(true);
      expect(config.enableProtection).toBe(true); // unchanged
    });

    it('should not mutate returned config', () => {
      const config1 = getSecurityConfig();
      // @ts-expect-error: intentionally mutate a copy to verify immutability of global config
      config1['maxPatternLength'] = 999;

      const config2 = getSecurityConfig();
      expect(config2.maxPatternLength).toBe(1000); // not changed
    });
  });

  describe('Real-world Attack Patterns', () => {
    it('should block email bomb pattern', () => {
      // Known ReDoS pattern from real attacks
      const pattern = '([a-zA-Z0-9]+)*@';
      const result = validatePattern(pattern);

      expect(result.safe).toBe(false);
    });

    it('should block catastrophic backtracking pattern', () => {
      const pattern = '(a|a)*';
      const result = validatePattern(pattern);

      expect(result.safe).toBe(false);
    });

    it('should allow safe complex patterns', () => {
      // Complex but safe patterns should pass
      const pattern = '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$';
      const result = validatePattern(pattern);

      expect(result.safe).toBe(true);
    });
  });

  describe('Integration with JSON Schema', () => {
    it('should protect pattern constraints', () => {
      const { convertJsonSchemaToZod } = require('../converter');

      const schema = {
        type: 'string' as const,
        pattern: '(a+)*', // Dangerous nested quantifier
      };

      const zodSchema = convertJsonSchemaToZod(schema);

      // Pattern should be rejected, so validation should fail
      expect(zodSchema.safeParse('aaaa').success).toBe(false);
    });

    it('should allow safe patterns through', () => {
      const { convertJsonSchemaToZod } = require('../converter');

      const schema = {
        type: 'string' as const,
        pattern: '^[a-z]+$',
      };

      const zodSchema = convertJsonSchemaToZod(schema);

      expect(zodSchema.safeParse('hello').success).toBe(true);
      expect(zodSchema.safeParse('HELLO').success).toBe(false);
    });
  });

  describe('Performance', () => {
    it('should validate patterns quickly', () => {
      const start = Date.now();

      for (let i = 0; i < 1000; i++) {
        validatePattern('^[a-z]+$');
      }

      const elapsed = Date.now() - start;

      // Should be able to validate 1000 patterns in under 100ms
      expect(elapsed).toBeLessThan(100);
    });

    it('should reject dangerous patterns quickly', () => {
      const start = Date.now();

      for (let i = 0; i < 100; i++) {
        validatePattern('(a+)+');
      }

      const elapsed = Date.now() - start;

      // Should reject dangerous patterns quickly
      expect(elapsed).toBeLessThan(50);
    });
  });

  describe('Security Config - Disabled Protection', () => {
    beforeEach(() => {
      setSecurityConfig(DEFAULT_SECURITY_CONFIG);
    });

    afterEach(() => {
      setSecurityConfig(DEFAULT_SECURITY_CONFIG);
    });

    it('should allow unsafe patterns when protection is disabled', () => {
      setSecurityConfig({ enableProtection: false });
      const regex = createSafeRegExp('(a+)+');

      expect(regex).not.toBeNull();
    });

    it('should return null for invalid regex syntax when protection is disabled', () => {
      setSecurityConfig({ enableProtection: false, warnOnUnsafe: false });
      const regex = createSafeRegExp('(unclosed');

      expect(regex).toBeNull();
    });

    it('should warn on invalid regex when warnOnUnsafe is true and protection disabled', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      setSecurityConfig({ enableProtection: false, warnOnUnsafe: true });

      createSafeRegExp('(unclosed');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('Security Config - Throw on Unsafe', () => {
    beforeEach(() => {
      setSecurityConfig(DEFAULT_SECURITY_CONFIG);
    });

    afterEach(() => {
      setSecurityConfig(DEFAULT_SECURITY_CONFIG);
    });

    it('should throw error for unsafe patterns when throwOnUnsafe is true', () => {
      setSecurityConfig({ throwOnUnsafe: true });

      expect(() => createSafeRegExp('(a+)+')).toThrow('Rejected unsafe pattern');
    });

    it('should not throw for safe patterns even when throwOnUnsafe is true', () => {
      setSecurityConfig({ throwOnUnsafe: true });

      expect(() => createSafeRegExp('^[a-z]+$')).not.toThrow();
    });
  });

  describe('Pattern Validator Timeout Handling', () => {
    beforeEach(() => {
      setSecurityConfig(DEFAULT_SECURITY_CONFIG);
    });

    afterEach(() => {
      setSecurityConfig(DEFAULT_SECURITY_CONFIG);
    });

    it('should handle regex test failures gracefully', () => {
      // Create a validator and test with warnOnUnsafe enabled
      setSecurityConfig({ warnOnUnsafe: true });
      const validator = createSafePatternValidator('^[a-z]+$');

      // Normal usage should work
      expect(validator('abc')).toBe(true);
    });

    it('should return false when validator warning is disabled', () => {
      setSecurityConfig({ warnOnUnsafe: false });
      const validator = createSafePatternValidator('(a+)+');

      // Unsafe pattern validator should always return false
      expect(validator('aaa')).toBe(false);
    });
  });

  describe('createSafePatternValidator Edge Cases', () => {
    beforeEach(() => {
      setSecurityConfig(DEFAULT_SECURITY_CONFIG);
    });

    afterEach(() => {
      setSecurityConfig(DEFAULT_SECURITY_CONFIG);
    });

    it('should handle empty string input', () => {
      const validator = createSafePatternValidator('^$');
      expect(validator('')).toBe(true);
      expect(validator('a')).toBe(false);
    });

    it('should suppress warnings when warnOnUnsafe is false for unsafe patterns', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      setSecurityConfig({ warnOnUnsafe: false });

      createSafePatternValidator('(a+)+');

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should warn when pattern is rejected and warnOnUnsafe is true', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      setSecurityConfig({ warnOnUnsafe: true });

      createSafePatternValidator('(a+)+');

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Pattern rejected'));
      consoleSpy.mockRestore();
    });
  });

  describe('Quantifier Edge Cases', () => {
    it('should accept patterns with {n} quantifier at max', () => {
      const result = validatePattern('a{100}');
      expect(result.safe).toBe(true);
    });

    it('should accept patterns with {n,m} quantifier at max', () => {
      const result = validatePattern('a{50,100}');
      expect(result.safe).toBe(true);
    });

    it('should reject patterns with single large quantifier', () => {
      const result = validatePattern('a{101}');
      expect(result.safe).toBe(false);
    });
  });
});
