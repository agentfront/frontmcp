/**
 * Base error class for all AST Guard errors
 */
export class AstGuardError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'AstGuardError';
    Object.setPrototypeOf(this, AstGuardError.prototype);
  }
}

/**
 * Error thrown when parsing fails
 */
export class ParseError extends AstGuardError {
  constructor(message: string, public readonly line?: number, public readonly column?: number) {
    super(message, 'PARSE_ERROR');
    this.name = 'ParseError';
    Object.setPrototypeOf(this, ParseError.prototype);
  }
}

/**
 * Error thrown when rule configuration is invalid
 */
export class RuleConfigurationError extends AstGuardError {
  constructor(message: string, public readonly ruleName: string) {
    super(message, 'RULE_CONFIGURATION_ERROR');
    this.name = 'RuleConfigurationError';
    Object.setPrototypeOf(this, RuleConfigurationError.prototype);
  }
}

/**
 * Error thrown when validation configuration is invalid
 */
export class ConfigurationError extends AstGuardError {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR');
    this.name = 'ConfigurationError';
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}

/**
 * Error thrown when a rule is not found
 */
export class RuleNotFoundError extends AstGuardError {
  constructor(public readonly ruleName: string) {
    super(`Rule not found: ${ruleName}`, 'RULE_NOT_FOUND');
    this.name = 'RuleNotFoundError';
    Object.setPrototypeOf(this, RuleNotFoundError.prototype);
  }
}

/**
 * Error thrown when source code is invalid
 */
export class InvalidSourceError extends AstGuardError {
  constructor(message: string) {
    super(message, 'INVALID_SOURCE');
    this.name = 'InvalidSourceError';
    Object.setPrototypeOf(this, InvalidSourceError.prototype);
  }
}
