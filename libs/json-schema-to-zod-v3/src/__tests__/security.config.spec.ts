import {
  validatePattern,
  createSafeRegExp,
  createSafePatternValidator,
  setSecurityConfig,
  getSecurityConfig,
  DEFAULT_SECURITY_CONFIG,
} from '../security';

describe('Security Configuration Wiring', () => {
  beforeEach(() => {
    // Reset to the default configuration before each test
    setSecurityConfig(DEFAULT_SECURITY_CONFIG);
  });

  describe('maxPatternLength configuration', () => {
    it('should use configured maxPatternLength in validatePattern', () => {
      // Set custom limit
      setSecurityConfig({ maxPatternLength: 10 });

      const shortPattern = 'a'.repeat(9);
      const longPattern = 'a'.repeat(11);

      expect(validatePattern(shortPattern).safe).toBe(true);
      expect(validatePattern(longPattern).safe).toBe(false);
      expect(validatePattern(longPattern).reason).toContain('10 characters');
    });

    it('should update when config changes', () => {
      const pattern = 'a'.repeat(50);

      // The default limit is 1000, should pass
      expect(validatePattern(pattern).safe).toBe(true);

      // Change to 40
      setSecurityConfig({ maxPatternLength: 40 });
      expect(validatePattern(pattern).safe).toBe(false);

      // Change to 60
      setSecurityConfig({ maxPatternLength: 60 });
      expect(validatePattern(pattern).safe).toBe(true);
    });
  });

  describe('maxQuantifier configuration', () => {
    it('should use configured maxQuantifier in validatePattern', () => {
      // Set custom limit
      setSecurityConfig({ maxQuantifier: 50 });

      const safePattern = 'a{1,40}';
      const unsafePattern = 'a{1,60}';

      expect(validatePattern(safePattern).safe).toBe(true);
      expect(validatePattern(unsafePattern).safe).toBe(false);
      expect(validatePattern(unsafePattern).reason).toContain('50');
    });

    it('should update when config changes', () => {
      const pattern = 'a{1,75}';

      // The default limit is 100, should pass
      expect(validatePattern(pattern).safe).toBe(true);

      // Change to 70
      setSecurityConfig({ maxQuantifier: 70 });
      expect(validatePattern(pattern).safe).toBe(false);

      // Change to 80
      setSecurityConfig({ maxQuantifier: 80 });
      expect(validatePattern(pattern).safe).toBe(true);
    });
  });

  describe('enableProtection configuration', () => {
    it('should bypass validation when protection is disabled', () => {
      setSecurityConfig({ enableProtection: false });

      // These patterns would normally be rejected
      const dangerousPattern = '(a+)*';
      const longPattern = 'a'.repeat(2000);

      const regex1 = createSafeRegExp(dangerousPattern);
      const regex2 = createSafeRegExp(longPattern);

      expect(regex1).not.toBeNull();
      expect(regex2).not.toBeNull();
    });

    it('should still validate when protection is enabled', () => {
      setSecurityConfig({ enableProtection: true });

      const dangerousPattern = '(a+)*';
      const regex = createSafeRegExp(dangerousPattern);

      expect(regex).toBeNull();
    });
  });

  describe('warnOnUnsafe configuration', () => {
    let consoleWarnSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    it('should log warnings when warnOnUnsafe is true', () => {
      setSecurityConfig({ warnOnUnsafe: true });

      createSafeRegExp('(a+)*');

      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleWarnSpy.mock.calls[0][0]).toContain('Rejected unsafe pattern');
    });

    it('should not log warnings when warnOnUnsafe is false', () => {
      setSecurityConfig({ warnOnUnsafe: false });

      createSafeRegExp('(a+)*');

      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should respect warnOnUnsafe in createSafePatternValidator', () => {
      setSecurityConfig({ warnOnUnsafe: false });

      createSafePatternValidator('(a+)*');

      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('throwOnUnsafe configuration', () => {
    it('should throw error when throwOnUnsafe is true', () => {
      setSecurityConfig({ throwOnUnsafe: true });

      expect(() => {
        createSafeRegExp('(a+)*');
      }).toThrow('Rejected unsafe pattern');
    });

    it('should not throw when throwOnUnsafe is false', () => {
      setSecurityConfig({ throwOnUnsafe: false });

      expect(() => {
        createSafeRegExp('(a+)*');
      }).not.toThrow();
    });

    it('should include reason in error message', () => {
      setSecurityConfig({ throwOnUnsafe: true });

      expect(() => {
        createSafeRegExp('(a+)*');
      }).toThrow(/dangerous constructs/);
    });
  });

  describe('timeoutMs configuration', () => {
    it('should use configured timeout', () => {
      // This is hard to test reliably without actually slow patterns
      // Just verify the config is being read
      setSecurityConfig({ timeoutMs: 50 });

      const config = getSecurityConfig();
      expect(config.timeoutMs).toBe(50);

      // Verify it's used in createSafePatternValidator
      const validator = createSafePatternValidator('^[a-z]+$');
      expect(validator).toBeDefined();
    });
  });

  describe('Combined configuration changes', () => {
    it('should honor multiple config changes simultaneously', () => {
      let consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      setSecurityConfig({
        maxPatternLength: 20,
        maxQuantifier: 30,
        warnOnUnsafe: false,
        throwOnUnsafe: true,
      });

      // Test maxPatternLength
      expect(() => validatePattern('a'.repeat(25))).not.toThrow();
      const result1 = validatePattern('a'.repeat(25));
      expect(result1.safe).toBe(false);

      // Test maxQuantifier
      const result2 = validatePattern('a{1,40}');
      expect(result2.safe).toBe(false);
      expect(result2.reason).toContain('30');

      // Test throwOnUnsafe
      expect(() => {
        createSafeRegExp('(a+)*');
      }).toThrow();

      // Test warnOnUnsafe (should not warn)
      expect(consoleWarnSpy).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });

    it('should allow config to be changed multiple times', () => {
      const pattern = 'a'.repeat(50);

      setSecurityConfig({ maxPatternLength: 40 });
      expect(validatePattern(pattern).safe).toBe(false);

      setSecurityConfig({ maxPatternLength: 60 });
      expect(validatePattern(pattern).safe).toBe(true);

      setSecurityConfig({ maxPatternLength: 45 });
      expect(validatePattern(pattern).safe).toBe(false);
    });
  });

  describe('Default configuration preservation', () => {
    it('should not mutate DEFAULT_SECURITY_CONFIG', () => {
      const originalDefaults = { ...DEFAULT_SECURITY_CONFIG };

      setSecurityConfig({ maxPatternLength: 500 });

      expect(DEFAULT_SECURITY_CONFIG).toEqual(originalDefaults);
    });

    it('should be able to reset to defaults', () => {
      setSecurityConfig({ maxPatternLength: 500, throwOnUnsafe: true });

      const config1 = getSecurityConfig();
      expect(config1.maxPatternLength).toBe(500);
      expect(config1.throwOnUnsafe).toBe(true);

      setSecurityConfig(DEFAULT_SECURITY_CONFIG);

      const config2 = getSecurityConfig();
      expect(config2.maxPatternLength).toBe(1000);
      expect(config2.throwOnUnsafe).toBe(false);
    });
  });

  describe('Integration with conversion', () => {
    it('should affect pattern validation during conversion', () => {
      const { convertJsonSchemaToZod } = require('../converter');

      setSecurityConfig({ throwOnUnsafe: true });

      const schema = {
        type: 'string' as const,
        pattern: '(a+)*',
      };

      // Should throw because throwOnUnsafe is true
      expect(() => {
        convertJsonSchemaToZod(schema);
      }).toThrow('Rejected unsafe pattern');
    });

    it('should allow patterns when protection is disabled', () => {
      const { convertJsonSchemaToZod } = require('../converter');

      setSecurityConfig({ enableProtection: false });

      const schema = {
        type: 'string' as const,
        pattern: '(a+)*',
      };

      const zodSchema = convertJsonSchemaToZod(schema);
      // With protection disabled, a pattern should work (though it's dangerous!)
      expect(zodSchema).toBeDefined();
    });
  });
});
