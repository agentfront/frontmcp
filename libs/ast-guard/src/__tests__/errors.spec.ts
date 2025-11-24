import {
  AstGuardError,
  ParseError,
  RuleConfigurationError,
  ConfigurationError,
  RuleNotFoundError,
  InvalidSourceError,
} from '../errors';

describe('Error Classes', () => {
  describe('AstGuardError', () => {
    it('should create error with message and code', () => {
      const error = new AstGuardError('Test error', 'TEST_CODE');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AstGuardError);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.name).toBe('AstGuardError');
    });

    it('should be instanceof AstGuardError after creation', () => {
      const error = new AstGuardError('Test', 'CODE');
      expect(error instanceof AstGuardError).toBe(true);
    });
  });

  describe('ParseError', () => {
    it('should create error with message only', () => {
      const error = new ParseError('Parse failed');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AstGuardError);
      expect(error).toBeInstanceOf(ParseError);
      expect(error.message).toBe('Parse failed');
      expect(error.code).toBe('PARSE_ERROR');
      expect(error.name).toBe('ParseError');
      expect(error.line).toBeUndefined();
      expect(error.column).toBeUndefined();
    });

    it('should create error with line and column', () => {
      const error = new ParseError('Unexpected token', 10, 5);

      expect(error.message).toBe('Unexpected token');
      expect(error.line).toBe(10);
      expect(error.column).toBe(5);
    });

    it('should be instanceof ParseError after creation', () => {
      const error = new ParseError('Test', 1, 1);
      expect(error instanceof ParseError).toBe(true);
      expect(error instanceof AstGuardError).toBe(true);
    });
  });

  describe('RuleConfigurationError', () => {
    it('should create error with message and rule name', () => {
      const error = new RuleConfigurationError('Invalid config', 'test-rule');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AstGuardError);
      expect(error).toBeInstanceOf(RuleConfigurationError);
      expect(error.message).toBe('Invalid config');
      expect(error.code).toBe('RULE_CONFIGURATION_ERROR');
      expect(error.name).toBe('RuleConfigurationError');
      expect(error.ruleName).toBe('test-rule');
    });

    it('should be instanceof RuleConfigurationError after creation', () => {
      const error = new RuleConfigurationError('Test', 'rule');
      expect(error instanceof RuleConfigurationError).toBe(true);
      expect(error instanceof AstGuardError).toBe(true);
    });
  });

  describe('ConfigurationError', () => {
    it('should create error with message', () => {
      const error = new ConfigurationError('Invalid configuration');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AstGuardError);
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(error.message).toBe('Invalid configuration');
      expect(error.code).toBe('CONFIGURATION_ERROR');
      expect(error.name).toBe('ConfigurationError');
    });

    it('should be instanceof ConfigurationError after creation', () => {
      const error = new ConfigurationError('Test');
      expect(error instanceof ConfigurationError).toBe(true);
      expect(error instanceof AstGuardError).toBe(true);
    });
  });

  describe('RuleNotFoundError', () => {
    it('should create error with rule name', () => {
      const error = new RuleNotFoundError('missing-rule');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AstGuardError);
      expect(error).toBeInstanceOf(RuleNotFoundError);
      expect(error.message).toBe('Rule not found: missing-rule');
      expect(error.code).toBe('RULE_NOT_FOUND');
      expect(error.name).toBe('RuleNotFoundError');
      expect(error.ruleName).toBe('missing-rule');
    });

    it('should be instanceof RuleNotFoundError after creation', () => {
      const error = new RuleNotFoundError('test');
      expect(error instanceof RuleNotFoundError).toBe(true);
      expect(error instanceof AstGuardError).toBe(true);
    });
  });

  describe('InvalidSourceError', () => {
    it('should create error with message', () => {
      const error = new InvalidSourceError('Source is empty');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AstGuardError);
      expect(error).toBeInstanceOf(InvalidSourceError);
      expect(error.message).toBe('Source is empty');
      expect(error.code).toBe('INVALID_SOURCE');
      expect(error.name).toBe('InvalidSourceError');
    });

    it('should be instanceof InvalidSourceError after creation', () => {
      const error = new InvalidSourceError('Test');
      expect(error instanceof InvalidSourceError).toBe(true);
      expect(error instanceof AstGuardError).toBe(true);
    });
  });

  describe('Error Inheritance', () => {
    it('should maintain proper prototype chain', () => {
      const baseError = new AstGuardError('base', 'CODE');
      const parseError = new ParseError('parse');
      const ruleConfigError = new RuleConfigurationError('config', 'rule');
      const configError = new ConfigurationError('config');
      const notFoundError = new RuleNotFoundError('rule');
      const invalidSourceError = new InvalidSourceError('source');

      // All should be instances of Error
      expect(baseError instanceof Error).toBe(true);
      expect(parseError instanceof Error).toBe(true);
      expect(ruleConfigError instanceof Error).toBe(true);
      expect(configError instanceof Error).toBe(true);
      expect(notFoundError instanceof Error).toBe(true);
      expect(invalidSourceError instanceof Error).toBe(true);

      // All specific errors should be instances of AstGuardError
      expect(parseError instanceof AstGuardError).toBe(true);
      expect(ruleConfigError instanceof AstGuardError).toBe(true);
      expect(configError instanceof AstGuardError).toBe(true);
      expect(notFoundError instanceof AstGuardError).toBe(true);
      expect(invalidSourceError instanceof AstGuardError).toBe(true);
    });
  });
});
