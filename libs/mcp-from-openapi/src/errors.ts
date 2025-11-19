/**
 * Base error class for all library errors
 */
export class OpenAPIToolError extends Error {
  public readonly context?: Record<string, any>;

  constructor(message: string, context?: Record<string, any>) {
    super(message);
    this.name = this.constructor.name;
    this.context = context;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error thrown when loading an OpenAPI specification fails
 */
export class LoadError extends OpenAPIToolError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, context);
  }
}

/**
 * Error thrown when parsing an OpenAPI specification fails
 */
export class ParseError extends OpenAPIToolError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, context);
  }
}

/**
 * Error thrown when validating an OpenAPI specification fails
 */
export class ValidationError extends OpenAPIToolError {
  public readonly errors?: any[];

  constructor(message: string, context?: Record<string, any>) {
    super(message, context);
    this.errors = context?.['errors'];
  }
}

/**
 * Error thrown when generating a tool fails
 */
export class GenerationError extends OpenAPIToolError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, context);
  }
}

/**
 * Error thrown when a schema is invalid
 */
export class SchemaError extends OpenAPIToolError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, context);
  }
}
