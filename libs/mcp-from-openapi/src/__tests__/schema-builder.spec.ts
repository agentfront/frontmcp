/**
 * Tests for SchemaBuilder class
 */

import { SchemaBuilder } from '../schema-builder';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('SchemaBuilder', () => {
  describe('merge', () => {
    it('should return empty object for empty array', () => {
      const result = SchemaBuilder.merge([]);
      expect(result).toEqual({ type: 'object' });
    });

    it('should return single schema unchanged', () => {
      const schema = { type: 'object', properties: { id: { type: 'string' } } } as any;
      const result = SchemaBuilder.merge([schema]);
      expect(result).toEqual(schema);
    });

    it('should merge multiple schemas', () => {
      const schema1 = {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      } as any;
      const schema2 = {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      } as any;
      const result = SchemaBuilder.merge([schema1, schema2]);

      expect(result.properties).toHaveProperty('id');
      expect(result.properties).toHaveProperty('name');
      expect(result.required).toContain('id');
      expect(result.required).toContain('name');
    });

    it('should handle schemas without properties', () => {
      const schema1 = { type: 'object' } as any;
      const schema2 = { type: 'object', properties: { id: { type: 'string' } } } as any;
      const result = SchemaBuilder.merge([schema1, schema2]);

      expect(result.properties).toHaveProperty('id');
    });

    it('should handle schemas without required', () => {
      const schema1 = { type: 'object', properties: { id: { type: 'string' } } } as any;
      const schema2 = { type: 'object', properties: { name: { type: 'string' } } } as any;
      const result = SchemaBuilder.merge([schema1, schema2]);

      expect(result.properties).toHaveProperty('id');
      expect(result.properties).toHaveProperty('name');
      expect(result.required).toEqual([]);
    });
  });

  describe('union', () => {
    it('should return empty object for empty array', () => {
      const result = SchemaBuilder.union([]);
      expect(result).toEqual({});
    });

    it('should return single schema unchanged', () => {
      const schema = { type: 'string' } as any;
      const result = SchemaBuilder.union([schema]);
      expect(result).toEqual(schema);
    });

    it('should create oneOf for multiple schemas', () => {
      const schemas = [{ type: 'string' }, { type: 'number' }] as any;
      const result = SchemaBuilder.union(schemas);

      expect(result.oneOf).toEqual(schemas);
    });
  });

  describe('clone', () => {
    it('should create deep copy', () => {
      const schema = {
        type: 'object',
        properties: {
          nested: { type: 'object', properties: { value: { type: 'string' } } },
        },
      } as any;
      const cloned = SchemaBuilder.clone(schema);

      expect(cloned).toEqual(schema);
      expect(cloned).not.toBe(schema);
      expect(cloned.properties).not.toBe(schema.properties);
    });
  });

  describe('removeRefs', () => {
    it('should remove $ref from schema', () => {
      const schema = {
        type: 'object',
        $ref: '#/components/schemas/User',
        properties: {
          nested: { $ref: '#/components/schemas/Address' },
        },
      } as any;
      const result = SchemaBuilder.removeRefs(schema);

      expect(result.$ref).toBeUndefined();
      expect((result as any).properties?.nested.$ref).toBeUndefined();
    });

    it('should handle null and primitive values', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          count: 42,
          nullable: null,
        },
      } as any;
      const result = SchemaBuilder.removeRefs(schema);

      expect(result.type).toBe('object');
      expect((result as any).properties?.count).toBe(42);
    });

    it('should handle arrays in schema', () => {
      const schema = {
        type: 'array',
        items: { $ref: '#/components/schemas/Item' },
      } as any;
      const result = SchemaBuilder.removeRefs(schema);

      expect((result as any).items.$ref).toBeUndefined();
    });
  });

  describe('withDescription', () => {
    it('should add description to schema', () => {
      const schema = { type: 'string' } as any;
      const result = SchemaBuilder.withDescription(schema, 'A test string');

      expect(result.description).toBe('A test string');
      expect(result.type).toBe('string');
    });
  });

  describe('withExample', () => {
    it('should add example to schema', () => {
      const schema = { type: 'string' } as any;
      const result = SchemaBuilder.withExample(schema, 'example value');

      expect(result.examples).toEqual(['example value']);
    });

    it('should append to existing examples', () => {
      const schema = { type: 'string', examples: ['existing'] } as any;
      const result = SchemaBuilder.withExample(schema, 'new example');

      expect(result.examples).toEqual(['existing', 'new example']);
    });

    it('should handle non-array examples gracefully', () => {
      const schema = { type: 'string', examples: 'not an array' } as any;
      const result = SchemaBuilder.withExample(schema, 'new example');

      expect(result.examples).toEqual(['new example']);
    });
  });

  describe('withDefault', () => {
    it('should add default value', () => {
      const schema = { type: 'string' } as any;
      const result = SchemaBuilder.withDefault(schema, 'default value');

      expect(result.default).toBe('default value');
    });
  });

  describe('withFormat', () => {
    it('should add format', () => {
      const schema = { type: 'string' } as any;
      const result = SchemaBuilder.withFormat(schema, 'email');

      expect(result.format).toBe('email');
    });
  });

  describe('withPattern', () => {
    it('should add pattern', () => {
      const schema = { type: 'string' } as any;
      const result = SchemaBuilder.withPattern(schema, '^[a-z]+$');

      expect(result.pattern).toBe('^[a-z]+$');
    });
  });

  describe('withEnum', () => {
    it('should add enum values', () => {
      const schema = { type: 'string' } as any;
      const result = SchemaBuilder.withEnum(schema, ['a', 'b', 'c']);

      expect(result.enum).toEqual(['a', 'b', 'c']);
    });
  });

  describe('withRange', () => {
    it('should add inclusive minimum and maximum', () => {
      const schema = { type: 'number' } as any;
      const result = SchemaBuilder.withRange(schema, 0, 100);

      expect(result.minimum).toBe(0);
      expect(result.maximum).toBe(100);
    });

    it('should add exclusive minimum and maximum', () => {
      const schema = { type: 'number' } as any;
      const result = SchemaBuilder.withRange(schema, 0, 100, { exclusive: true });

      expect(result.exclusiveMinimum).toBe(0);
      expect(result.exclusiveMaximum).toBe(100);
    });

    it('should handle only minimum', () => {
      const schema = { type: 'number' } as any;
      const result = SchemaBuilder.withRange(schema, 0, undefined);

      expect(result.minimum).toBe(0);
      expect(result.maximum).toBeUndefined();
    });

    it('should handle only maximum', () => {
      const schema = { type: 'number' } as any;
      const result = SchemaBuilder.withRange(schema, undefined, 100);

      expect(result.minimum).toBeUndefined();
      expect(result.maximum).toBe(100);
    });
  });

  describe('withLength', () => {
    it('should add minLength and maxLength', () => {
      const schema = { type: 'string' } as any;
      const result = SchemaBuilder.withLength(schema, 1, 100);

      expect(result.minLength).toBe(1);
      expect(result.maxLength).toBe(100);
    });

    it('should handle only minLength', () => {
      const schema = { type: 'string' } as any;
      const result = SchemaBuilder.withLength(schema, 1, undefined);

      expect(result.minLength).toBe(1);
      expect(result.maxLength).toBeUndefined();
    });

    it('should handle only maxLength', () => {
      const schema = { type: 'string' } as any;
      const result = SchemaBuilder.withLength(schema, undefined, 100);

      expect(result.minLength).toBeUndefined();
      expect(result.maxLength).toBe(100);
    });
  });

  describe('object', () => {
    it('should create object schema', () => {
      const result = SchemaBuilder.object({ id: { type: 'string' }, name: { type: 'string' } } as any, ['id']);

      expect(result.type).toBe('object');
      expect(result.properties).toHaveProperty('id');
      expect(result.properties).toHaveProperty('name');
      expect(result.required).toEqual(['id']);
      expect(result.additionalProperties).toBe(false);
    });

    it('should create object without required', () => {
      const result = SchemaBuilder.object({ id: { type: 'string' } } as any);

      expect(result.required).toBeUndefined();
    });

    it('should create object with empty required', () => {
      const result = SchemaBuilder.object({ id: { type: 'string' } } as any, []);

      expect(result.required).toBeUndefined();
    });
  });

  describe('array', () => {
    it('should create array schema', () => {
      const result = SchemaBuilder.array({ type: 'string' } as any);

      expect(result.type).toBe('array');
      expect(result.items).toEqual({ type: 'string' });
    });

    it('should add constraints', () => {
      const result = SchemaBuilder.array({ type: 'string' } as any, { minItems: 1, maxItems: 10, uniqueItems: true });

      expect(result.minItems).toBe(1);
      expect(result.maxItems).toBe(10);
      expect(result.uniqueItems).toBe(true);
    });
  });

  describe('string', () => {
    it('should create string schema', () => {
      const result = SchemaBuilder.string();

      expect(result.type).toBe('string');
    });

    it('should add constraints', () => {
      const result = SchemaBuilder.string({
        minLength: 1,
        maxLength: 100,
        pattern: '^[a-z]+$',
        format: 'email',
        enum: ['a', 'b'],
      });

      expect(result.minLength).toBe(1);
      expect(result.maxLength).toBe(100);
      expect(result.pattern).toBe('^[a-z]+$');
      expect(result.format).toBe('email');
      expect(result.enum).toEqual(['a', 'b']);
    });
  });

  describe('number', () => {
    it('should create number schema', () => {
      const result = SchemaBuilder.number();

      expect(result.type).toBe('number');
    });

    it('should add constraints', () => {
      const result = SchemaBuilder.number({
        minimum: 0,
        maximum: 100,
        exclusiveMinimum: -1,
        exclusiveMaximum: 101,
        multipleOf: 5,
      });

      expect(result.minimum).toBe(0);
      expect(result.maximum).toBe(100);
      expect(result.exclusiveMinimum).toBe(-1);
      expect(result.exclusiveMaximum).toBe(101);
      expect(result.multipleOf).toBe(5);
    });
  });

  describe('integer', () => {
    it('should create integer schema', () => {
      const result = SchemaBuilder.integer();

      expect(result.type).toBe('integer');
    });

    it('should add constraints', () => {
      const result = SchemaBuilder.integer({
        minimum: 0,
        maximum: 100,
      });

      expect(result.minimum).toBe(0);
      expect(result.maximum).toBe(100);
    });
  });

  describe('boolean', () => {
    it('should create boolean schema', () => {
      const result = SchemaBuilder.boolean();

      expect(result.type).toBe('boolean');
    });
  });

  describe('null', () => {
    it('should create null schema', () => {
      const result = SchemaBuilder.null();

      expect(result.type).toBe('null');
    });
  });

  describe('flatten', () => {
    it('should flatten nested oneOf', () => {
      const schema = {
        oneOf: [{ type: 'string' }, { oneOf: [{ type: 'number' }, { type: 'boolean' }] }],
      } as any;
      const result = SchemaBuilder.flatten(schema);

      expect(result.oneOf).toHaveLength(3);
    });

    it('should flatten nested anyOf', () => {
      const schema = {
        anyOf: [{ type: 'string' }, { anyOf: [{ type: 'number' }, { type: 'boolean' }] }],
      } as any;
      const result = SchemaBuilder.flatten(schema);

      expect(result.anyOf).toHaveLength(3);
    });

    it('should flatten nested allOf', () => {
      const schema = {
        allOf: [
          { type: 'object', properties: { a: { type: 'string' } } },
          { allOf: [{ properties: { b: { type: 'number' } } }] },
        ],
      } as any;
      const result = SchemaBuilder.flatten(schema);

      expect(result.allOf).toHaveLength(2);
    });

    it('should respect maxDepth', () => {
      const schema = {
        oneOf: [{ oneOf: [{ oneOf: [{ type: 'string' }] }] }],
      } as any;
      const result = SchemaBuilder.flatten(schema, 1);

      // Should only flatten one level
      expect(result.oneOf).toBeDefined();
    });

    it('should handle schema without composition', () => {
      const schema = { type: 'string' } as any;
      const result = SchemaBuilder.flatten(schema);

      expect(result.type).toBe('string');
    });
  });

  describe('simplify', () => {
    it('should remove empty required array', () => {
      const schema = { type: 'object', required: [] } as any;
      const result = SchemaBuilder.simplify(schema);

      expect(result.required).toBeUndefined();
    });

    it('should remove empty properties object', () => {
      const schema = { type: 'object', properties: {} } as any;
      const result = SchemaBuilder.simplify(schema);

      expect(result.properties).toBeUndefined();
    });

    it('should remove empty examples array', () => {
      const schema = { type: 'string', examples: [] } as any;
      const result = SchemaBuilder.simplify(schema);

      expect(result.examples).toBeUndefined();
    });

    it('should remove duplicate title when matching description', () => {
      const schema = { type: 'string', title: 'Same', description: 'Same' } as any;
      const result = SchemaBuilder.simplify(schema);

      expect(result.title).toBeUndefined();
      expect(result.description).toBe('Same');
    });

    it('should keep title when different from description', () => {
      const schema = { type: 'string', title: 'Title', description: 'Desc' } as any;
      const result = SchemaBuilder.simplify(schema);

      expect(result.title).toBe('Title');
      expect(result.description).toBe('Desc');
    });

    it('should keep non-empty collections', () => {
      const schema = {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        examples: ['example'],
      } as any;
      const result = SchemaBuilder.simplify(schema);

      expect(result.properties).toHaveProperty('id');
      expect(result.required).toEqual(['id']);
      expect(result.examples).toEqual(['example']);
    });
  });
});
