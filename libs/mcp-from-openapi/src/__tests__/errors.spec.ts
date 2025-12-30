/**
 * Tests for error classes
 */

import { OpenAPIToolError, LoadError, ParseError, ValidationError, GenerationError, SchemaError } from '../errors';

describe('OpenAPIToolError', () => {
  it('should create error with message', () => {
    const error = new OpenAPIToolError('Test error');

    expect(error.message).toBe('Test error');
    expect(error.name).toBe('OpenAPIToolError');
    expect(error.context).toBeUndefined();
  });

  it('should create error with context', () => {
    const error = new OpenAPIToolError('Test error', { key: 'value', num: 42 });

    expect(error.message).toBe('Test error');
    expect(error.context).toEqual({ key: 'value', num: 42 });
  });

  it('should be instance of Error', () => {
    const error = new OpenAPIToolError('Test error');

    expect(error).toBeInstanceOf(Error);
  });

  it('should capture stack trace', () => {
    const error = new OpenAPIToolError('Test error');

    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('OpenAPIToolError');
  });
});

describe('LoadError', () => {
  it('should create error with message', () => {
    const error = new LoadError('Failed to load');

    expect(error.message).toBe('Failed to load');
    expect(error.name).toBe('LoadError');
  });

  it('should create error with context', () => {
    const error = new LoadError('Failed to load', { path: '/api/spec.yaml' });

    expect(error.context).toEqual({ path: '/api/spec.yaml' });
  });

  it('should be instance of OpenAPIToolError', () => {
    const error = new LoadError('Failed to load');

    expect(error).toBeInstanceOf(OpenAPIToolError);
  });
});

describe('ParseError', () => {
  it('should create error with message', () => {
    const error = new ParseError('Invalid JSON');

    expect(error.message).toBe('Invalid JSON');
    expect(error.name).toBe('ParseError');
  });

  it('should create error with context', () => {
    const error = new ParseError('Invalid YAML', { line: 10, column: 5 });

    expect(error.context).toEqual({ line: 10, column: 5 });
  });

  it('should be instance of OpenAPIToolError', () => {
    const error = new ParseError('Parse failed');

    expect(error).toBeInstanceOf(OpenAPIToolError);
  });
});

describe('ValidationError', () => {
  it('should create error with message', () => {
    const error = new ValidationError('Validation failed');

    expect(error.message).toBe('Validation failed');
    expect(error.name).toBe('ValidationError');
    expect(error.errors).toBeUndefined();
  });

  it('should create error with errors array in context', () => {
    const validationErrors = [
      { path: '/paths', message: 'Invalid path' },
      { path: '/info', message: 'Missing title' },
    ];
    const error = new ValidationError('Validation failed', {
      errors: validationErrors,
    });

    expect(error.errors).toEqual(validationErrors);
  });

  it('should be instance of OpenAPIToolError', () => {
    const error = new ValidationError('Validation failed');

    expect(error).toBeInstanceOf(OpenAPIToolError);
  });
});

describe('GenerationError', () => {
  it('should create error with message', () => {
    const error = new GenerationError('Generation failed');

    expect(error.message).toBe('Generation failed');
    expect(error.name).toBe('GenerationError');
  });

  it('should create error with context', () => {
    const error = new GenerationError('Tool generation failed', {
      path: '/users',
      method: 'get',
    });

    expect(error.context).toEqual({ path: '/users', method: 'get' });
  });

  it('should be instance of OpenAPIToolError', () => {
    const error = new GenerationError('Failed');

    expect(error).toBeInstanceOf(OpenAPIToolError);
  });
});

describe('SchemaError', () => {
  it('should create error with message', () => {
    const error = new SchemaError('Invalid schema');

    expect(error.message).toBe('Invalid schema');
    expect(error.name).toBe('SchemaError');
  });

  it('should create error with context', () => {
    const error = new SchemaError('Schema validation failed', {
      schema: { type: 'invalid' },
    });

    expect(error.context).toEqual({ schema: { type: 'invalid' } });
  });

  it('should be instance of OpenAPIToolError', () => {
    const error = new SchemaError('Failed');

    expect(error).toBeInstanceOf(OpenAPIToolError);
  });
});

describe('Error Inheritance Chain', () => {
  it('should have correct inheritance for all error types', () => {
    const errors = [
      new LoadError('Load'),
      new ParseError('Parse'),
      new ValidationError('Validation'),
      new GenerationError('Generation'),
      new SchemaError('Schema'),
    ];

    for (const error of errors) {
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(OpenAPIToolError);
    }
  });

  it('should preserve stack traces', () => {
    function throwLoadError() {
      throw new LoadError('From function');
    }

    expect(throwLoadError).toThrow(LoadError);

    try {
      throwLoadError();
    } catch (e) {
      expect((e as LoadError).stack).toContain('throwLoadError');
    }
  });
});
