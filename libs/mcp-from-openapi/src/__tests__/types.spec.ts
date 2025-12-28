/**
 * Tests for types utility functions
 */

import { isReferenceObject, toJsonSchema } from '../types';
import type { SchemaObject, ReferenceObject } from '../types';

describe('isReferenceObject', () => {
  it('should return true for reference objects', () => {
    const ref: ReferenceObject = { $ref: '#/components/schemas/User' };
    expect(isReferenceObject(ref)).toBe(true);
  });

  it('should return falsy for null', () => {
    expect(isReferenceObject(null)).toBeFalsy();
  });

  it('should return falsy for undefined', () => {
    expect(isReferenceObject(undefined)).toBeFalsy();
  });

  it('should return false for primitives', () => {
    expect(isReferenceObject('string')).toBe(false);
    expect(isReferenceObject(42)).toBe(false);
    expect(isReferenceObject(true)).toBe(false);
  });

  it('should return false for objects without $ref', () => {
    const schema: SchemaObject = { type: 'string' };
    expect(isReferenceObject(schema)).toBe(false);
  });

  it('should return false for objects with empty $ref', () => {
    const obj = { $ref: '', type: 'string' };
    expect(isReferenceObject(obj)).toBe(true); // Has $ref key, even if empty
  });
});

describe('toJsonSchema', () => {
  describe('Reference Objects', () => {
    it('should convert reference to JSON Schema $ref', () => {
      const ref: ReferenceObject = { $ref: '#/components/schemas/User' };
      const result = toJsonSchema(ref);

      expect(result.$ref).toBe('#/components/schemas/User');
    });
  });

  describe('Basic Schemas', () => {
    it('should convert simple string schema', () => {
      const schema: SchemaObject = { type: 'string' };
      const result = toJsonSchema(schema);

      expect(result.type).toBe('string');
    });

    it('should convert string schema with constraints', () => {
      const schema: SchemaObject = {
        type: 'string',
        minLength: 1,
        maxLength: 100,
        pattern: '^[a-z]+$',
      };
      const result = toJsonSchema(schema);

      expect(result.minLength).toBe(1);
      expect(result.maxLength).toBe(100);
      expect(result.pattern).toBe('^[a-z]+$');
    });

    it('should convert number schema', () => {
      const schema: SchemaObject = {
        type: 'number',
        minimum: 0,
        maximum: 100,
      };
      const result = toJsonSchema(schema);

      expect(result.type).toBe('number');
      expect(result.minimum).toBe(0);
      expect(result.maximum).toBe(100);
    });
  });

  describe('ExclusiveMinimum/Maximum Conversion', () => {
    it('should convert boolean exclusiveMaximum with maximum', () => {
      const schema: SchemaObject = {
        type: 'number',
        maximum: 100,
        exclusiveMaximum: true as any, // OpenAPI 3.0 style
      };
      const result = toJsonSchema(schema);

      expect(result.exclusiveMaximum).toBe(100);
      expect(result.maximum).toBeUndefined();
    });

    it('should keep maximum when exclusiveMaximum is false', () => {
      const schema: SchemaObject = {
        type: 'number',
        maximum: 100,
        exclusiveMaximum: false as any, // OpenAPI 3.0 style
      };
      const result = toJsonSchema(schema);

      expect(result.maximum).toBe(100);
      expect(result.exclusiveMaximum).toBeUndefined();
    });

    it('should convert boolean exclusiveMinimum with minimum', () => {
      const schema: SchemaObject = {
        type: 'number',
        minimum: 0,
        exclusiveMinimum: true as any, // OpenAPI 3.0 style
      };
      const result = toJsonSchema(schema);

      expect(result.exclusiveMinimum).toBe(0);
      expect(result.minimum).toBeUndefined();
    });

    it('should keep minimum when exclusiveMinimum is false', () => {
      const schema: SchemaObject = {
        type: 'number',
        minimum: 0,
        exclusiveMinimum: false as any, // OpenAPI 3.0 style
      };
      const result = toJsonSchema(schema);

      expect(result.minimum).toBe(0);
      expect(result.exclusiveMinimum).toBeUndefined();
    });

    it('should keep numeric exclusiveMaximum (OpenAPI 3.1)', () => {
      const schema: SchemaObject = {
        type: 'number',
        exclusiveMaximum: 100,
        maximum: 50,
      };
      const result = toJsonSchema(schema);

      expect(result.exclusiveMaximum).toBe(100);
      expect(result.maximum).toBe(50);
    });

    it('should keep numeric exclusiveMinimum (OpenAPI 3.1)', () => {
      const schema: SchemaObject = {
        type: 'number',
        exclusiveMinimum: 0,
        minimum: -10,
      };
      const result = toJsonSchema(schema);

      expect(result.exclusiveMinimum).toBe(0);
      expect(result.minimum).toBe(-10);
    });

    it('should handle only maximum without exclusiveMaximum', () => {
      const schema: SchemaObject = {
        type: 'number',
        maximum: 100,
      };
      const result = toJsonSchema(schema);

      expect(result.maximum).toBe(100);
      expect(result.exclusiveMaximum).toBeUndefined();
    });

    it('should handle only minimum without exclusiveMinimum', () => {
      const schema: SchemaObject = {
        type: 'number',
        minimum: 0,
      };
      const result = toJsonSchema(schema);

      expect(result.minimum).toBe(0);
      expect(result.exclusiveMinimum).toBeUndefined();
    });

    it('should handle boolean exclusiveMaximum true without maximum', () => {
      const schema: SchemaObject = {
        type: 'number',
        exclusiveMaximum: true as any,
      };
      const result = toJsonSchema(schema);

      // Boolean exclusive without value should not add anything
      expect(result.exclusiveMaximum).toBeUndefined();
      expect(result.maximum).toBeUndefined();
    });

    it('should handle boolean exclusiveMinimum true without minimum', () => {
      const schema: SchemaObject = {
        type: 'number',
        exclusiveMinimum: true as any,
      };
      const result = toJsonSchema(schema);

      // Boolean exclusive without value should not add anything
      expect(result.exclusiveMinimum).toBeUndefined();
      expect(result.minimum).toBeUndefined();
    });
  });

  describe('Nested Properties', () => {
    it('should recursively convert properties', () => {
      const schema: SchemaObject = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          age: {
            type: 'number',
            minimum: 0,
            exclusiveMaximum: true as any,
            maximum: 150,
          },
        },
      };
      const result = toJsonSchema(schema);

      expect(result.properties?.id.type).toBe('string');
      expect(result.properties?.age.exclusiveMaximum).toBe(150);
    });

    it('should recursively convert nested object properties', () => {
      const schema: SchemaObject = {
        type: 'object',
        properties: {
          address: {
            type: 'object',
            properties: {
              street: { type: 'string' },
            },
          },
        },
      };
      const result = toJsonSchema(schema);

      expect(result.properties?.address.properties?.street.type).toBe('string');
    });
  });

  describe('Array Items', () => {
    it('should convert single items schema', () => {
      const schema: SchemaObject = {
        type: 'array',
        items: { type: 'string' },
      };
      const result = toJsonSchema(schema);

      expect(result.items?.type).toBe('string');
    });

    it('should convert array of items schemas', () => {
      const schema = {
        type: 'array',
        items: [{ type: 'string' }, { type: 'number' }],
      } as any;
      const result = toJsonSchema(schema);

      expect(Array.isArray(result.items)).toBe(true);
      expect((result.items as any[])[0].type).toBe('string');
      expect((result.items as any[])[1].type).toBe('number');
    });

    it('should convert items with reference', () => {
      const schema: SchemaObject = {
        type: 'array',
        items: { $ref: '#/components/schemas/User' } as any,
      };
      const result = toJsonSchema(schema);

      expect(result.items?.$ref).toBe('#/components/schemas/User');
    });
  });

  describe('Additional Properties', () => {
    it('should convert additionalProperties schema', () => {
      const schema: SchemaObject = {
        type: 'object',
        additionalProperties: { type: 'string' },
      };
      const result = toJsonSchema(schema);

      expect(result.additionalProperties?.type).toBe('string');
    });

    it('should handle boolean additionalProperties', () => {
      const schema: SchemaObject = {
        type: 'object',
        additionalProperties: true,
      };
      const result = toJsonSchema(schema);

      expect(result.additionalProperties).toBe(true);
    });
  });

  describe('Composition Keywords', () => {
    it('should convert allOf schemas', () => {
      const schema: SchemaObject = {
        allOf: [
          { type: 'object', properties: { a: { type: 'string' } } },
          { type: 'object', properties: { b: { type: 'number' } } },
        ],
      };
      const result = toJsonSchema(schema);

      expect(result.allOf).toHaveLength(2);
      expect(result.allOf?.[0].properties?.a.type).toBe('string');
    });

    it('should convert anyOf schemas', () => {
      const schema: SchemaObject = {
        anyOf: [{ type: 'string' }, { type: 'number' }],
      };
      const result = toJsonSchema(schema);

      expect(result.anyOf).toHaveLength(2);
    });

    it('should convert oneOf schemas', () => {
      const schema: SchemaObject = {
        oneOf: [{ type: 'string' }, { type: 'null' as any }],
      };
      const result = toJsonSchema(schema);

      expect(result.oneOf).toHaveLength(2);
    });
  });

  describe('Not Keyword', () => {
    it('should convert not schema', () => {
      const schema: SchemaObject = {
        not: { type: 'null' as any },
      };
      const result = toJsonSchema(schema);

      expect(result.not?.type).toBe('null');
    });

    it('should convert not with reference', () => {
      const schema: SchemaObject = {
        not: { $ref: '#/components/schemas/Forbidden' } as any,
      };
      const result = toJsonSchema(schema);

      expect(result.not?.$ref).toBe('#/components/schemas/Forbidden');
    });
  });

  describe('Complex Schemas', () => {
    it('should handle deeply nested schema', () => {
      const schema: SchemaObject = {
        type: 'object',
        properties: {
          users: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                profile: {
                  type: 'object',
                  properties: {
                    score: {
                      type: 'number',
                      minimum: 0,
                      maximum: 100,
                      exclusiveMinimum: true as any,
                    },
                  },
                },
              },
            },
          },
        },
      };
      const result = toJsonSchema(schema);

      const scoreSchema = result.properties?.users.items?.properties?.profile.properties?.score;
      expect(scoreSchema?.exclusiveMinimum).toBe(0);
      expect(scoreSchema?.maximum).toBe(100);
    });

    it('should handle schema with all composition keywords', () => {
      const schema: SchemaObject = {
        allOf: [{ type: 'object' }],
        anyOf: [{ type: 'object' }],
        oneOf: [{ type: 'object' }],
        not: { type: 'null' as any },
      };
      const result = toJsonSchema(schema);

      expect(result.allOf).toBeDefined();
      expect(result.anyOf).toBeDefined();
      expect(result.oneOf).toBeDefined();
      expect(result.not).toBeDefined();
    });
  });
});
