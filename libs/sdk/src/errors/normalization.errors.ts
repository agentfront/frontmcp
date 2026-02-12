import { InternalMcpError } from './mcp.error';

/**
 * Thrown when a provider/entity definition is missing the 'provide' token.
 */
export class MissingProvideError extends InternalMcpError {
  constructor(entityType: string, name: string) {
    super(`${entityType} '${name}' is missing 'provide'.`, 'MISSING_PROVIDE');
  }
}

/**
 * Thrown when 'useClass' on a provider/entity is not a valid class (constructor function).
 */
export class InvalidUseClassError extends InternalMcpError {
  constructor(entityType: string, tokenName: string) {
    super(`'useClass' on ${entityType} '${tokenName}' must be a class.`, 'INVALID_USE_CLASS');
  }
}

/**
 * Thrown when 'useFactory' on a provider/entity is not a function.
 */
export class InvalidUseFactoryError extends InternalMcpError {
  constructor(entityType: string, tokenName: string) {
    super(`'useFactory' on ${entityType} '${tokenName}' must be a function.`, 'INVALID_USE_FACTORY');
  }
}

/**
 * Thrown when 'useValue' on a provider/entity is undefined.
 */
export class InvalidUseValueError extends InternalMcpError {
  constructor(entityType: string, tokenName: string) {
    super(`'useValue' on ${entityType} '${tokenName}' must be defined.`, 'INVALID_USE_VALUE');
  }
}

/**
 * Thrown when an entity (tool, resource, adapter, etc.) has an invalid shape.
 */
export class InvalidEntityError extends InternalMcpError {
  constructor(entityType: string, name: string, expected: string) {
    super(`Invalid ${entityType} '${name}'. Expected ${expected}.`, 'INVALID_ENTITY');
  }
}
