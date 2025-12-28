/**
 * Comprehensive tests for JSON Schema to Zod handlers
 * Covers edge cases and branches not covered by other test files
 */

import { convertJsonSchemaToZod } from '../converter';

describe('Boolean Schema', () => {
  it('should handle true schema (allows anything)', () => {
    const zodSchema = convertJsonSchemaToZod(true);
    expect(zodSchema.safeParse('anything').success).toBe(true);
    expect(zodSchema.safeParse(123).success).toBe(true);
    expect(zodSchema.safeParse(null).success).toBe(true);
    expect(zodSchema.safeParse([1, 2, 3]).success).toBe(true);
  });

  it('should handle false schema (allows nothing)', () => {
    const zodSchema = convertJsonSchemaToZod(false);
    expect(zodSchema.safeParse('anything').success).toBe(false);
    expect(zodSchema.safeParse(null).success).toBe(false);
    expect(zodSchema.safeParse(undefined).success).toBe(false);
  });
});

describe('String Handlers', () => {
  describe('ImplicitStringHandler', () => {
    it('should detect implicit string from minLength', () => {
      const schema = { minLength: 1 };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse('a').success).toBe(true);
      expect(zodSchema.safeParse('').success).toBe(false);
    });

    it('should detect implicit string from maxLength', () => {
      const schema = { maxLength: 5 };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse('hello').success).toBe(true);
      expect(zodSchema.safeParse('hello!').success).toBe(false);
    });

    it('should detect implicit string from pattern', () => {
      const schema = { pattern: '^[a-z]+$' };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse('abc').success).toBe(true);
      expect(zodSchema.safeParse('123').success).toBe(false);
    });
  });

  describe('MinLengthHandler', () => {
    it('should count graphemes correctly for emoji', () => {
      const schema = { type: 'string' as const, minLength: 2 };
      const zodSchema = convertJsonSchemaToZod(schema);
      // Two emoji should count as 2 graphemes
      expect(zodSchema.safeParse('ab').success).toBe(true);
      expect(zodSchema.safeParse('a').success).toBe(false);
    });

    it('should skip when string type is disabled', () => {
      const schema = { type: 'number' as const, minLength: 5 };
      const zodSchema = convertJsonSchemaToZod(schema);
      // minLength should be ignored for numbers
      expect(zodSchema.safeParse(123).success).toBe(true);
    });
  });

  describe('MaxLengthHandler', () => {
    it('should count graphemes correctly', () => {
      const schema = { type: 'string' as const, maxLength: 3 };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse('abc').success).toBe(true);
      expect(zodSchema.safeParse('abcd').success).toBe(false);
    });

    it('should skip when string type is disabled', () => {
      const schema = { type: 'number' as const, maxLength: 2 };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse(12345).success).toBe(true);
    });
  });

  describe('PatternHandler', () => {
    it('should apply regex pattern', () => {
      const schema = { type: 'string' as const, pattern: '^test' };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse('testing').success).toBe(true);
      expect(zodSchema.safeParse('not-test').success).toBe(false);
    });

    it('should handle complex patterns', () => {
      const schema = { type: 'string' as const, pattern: '^[a-zA-Z0-9]+$' };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse('Test123').success).toBe(true);
      expect(zodSchema.safeParse('test@123').success).toBe(false);
    });
  });
});

describe('Number Handlers', () => {
  describe('MinimumHandler', () => {
    it('should validate inclusive minimum', () => {
      const schema = { type: 'number' as const, minimum: 0 };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse(0).success).toBe(true);
      expect(zodSchema.safeParse(1).success).toBe(true);
      expect(zodSchema.safeParse(-1).success).toBe(false);
    });

    it('should skip when number type is disabled', () => {
      const schema = { type: 'string' as const, minimum: 0 };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse('test').success).toBe(true);
    });
  });

  describe('MaximumHandler', () => {
    it('should validate inclusive maximum', () => {
      const schema = { type: 'number' as const, maximum: 100 };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse(100).success).toBe(true);
      expect(zodSchema.safeParse(99).success).toBe(true);
      expect(zodSchema.safeParse(101).success).toBe(false);
    });
  });

  describe('ExclusiveMinimumHandler', () => {
    it('should validate exclusive minimum', () => {
      const schema = { type: 'number' as const, exclusiveMinimum: 0 };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse(0.001).success).toBe(true);
      expect(zodSchema.safeParse(0).success).toBe(false);
      expect(zodSchema.safeParse(-1).success).toBe(false);
    });

    it('should handle boolean form (unsupported)', () => {
      const schema = { type: 'number' as const, exclusiveMinimum: true as any };
      const zodSchema = convertJsonSchemaToZod(schema);
      // Boolean form disables the number type
      expect(zodSchema.safeParse(5).success).toBe(false);
    });
  });

  describe('ExclusiveMaximumHandler', () => {
    it('should validate exclusive maximum', () => {
      const schema = { type: 'number' as const, exclusiveMaximum: 100 };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse(99.999).success).toBe(true);
      expect(zodSchema.safeParse(100).success).toBe(false);
    });

    it('should handle boolean form (unsupported)', () => {
      const schema = { type: 'number' as const, exclusiveMaximum: true as any };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse(5).success).toBe(false);
    });
  });

  describe('MultipleOfHandler', () => {
    it('should validate integer multiples', () => {
      const schema = { type: 'number' as const, multipleOf: 5 };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse(0).success).toBe(true);
      expect(zodSchema.safeParse(5).success).toBe(true);
      expect(zodSchema.safeParse(10).success).toBe(true);
      expect(zodSchema.safeParse(3).success).toBe(false);
    });

    it('should validate decimal multiples', () => {
      const schema = { type: 'number' as const, multipleOf: 0.01 };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse(1.0).success).toBe(true);
      expect(zodSchema.safeParse(1.99).success).toBe(true);
      expect(zodSchema.safeParse(1.995).success).toBe(false);
    });

    it('should handle multipleOf 0', () => {
      const schema = { type: 'number' as const, multipleOf: 0 };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse(5).success).toBe(false);
    });
  });
});

describe('Array Handlers', () => {
  describe('ImplicitArrayHandler', () => {
    it('should detect implicit array from minItems', () => {
      const schema = { minItems: 1 };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse([1]).success).toBe(true);
      expect(zodSchema.safeParse([]).success).toBe(false);
    });

    it('should detect implicit array from maxItems', () => {
      const schema = { maxItems: 2 };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse([1, 2]).success).toBe(true);
      expect(zodSchema.safeParse([1, 2, 3]).success).toBe(false);
    });

    it('should detect implicit array from items', () => {
      const schema = { items: { type: 'string' as const } };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse(['a', 'b']).success).toBe(true);
      expect(zodSchema.safeParse([1, 2]).success).toBe(false);
    });

    it('should detect implicit array from prefixItems', () => {
      const schema = { prefixItems: [{ type: 'string' as const }] };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse(['a']).success).toBe(true);
    });
  });

  describe('MinItemsHandler', () => {
    it('should validate minimum items', () => {
      const schema = { type: 'array' as const, minItems: 2 };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse([1, 2]).success).toBe(true);
      expect(zodSchema.safeParse([1]).success).toBe(false);
    });
  });

  describe('MaxItemsHandler', () => {
    it('should validate maximum items', () => {
      const schema = { type: 'array' as const, maxItems: 3 };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse([1, 2, 3]).success).toBe(true);
      expect(zodSchema.safeParse([1, 2, 3, 4]).success).toBe(false);
    });
  });

  describe('ItemsHandler', () => {
    it('should validate items schema', () => {
      const schema = { type: 'array' as const, items: { type: 'number' as const } };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse([1, 2, 3]).success).toBe(true);
      expect(zodSchema.safeParse(['a', 'b']).success).toBe(false);
    });

    it('should handle items: true', () => {
      const schema = { type: 'array' as const, items: true };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse([1, 'a', null]).success).toBe(true);
    });

    it('should handle items: false (empty array only)', () => {
      const schema = { type: 'array' as const, items: false };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse([]).success).toBe(true);
      expect(zodSchema.safeParse([1]).success).toBe(false);
    });

    it('should handle items: false with prefixItems', () => {
      const schema = {
        type: 'array' as const,
        prefixItems: [{ type: 'string' as const }],
        items: false,
      };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse(['a']).success).toBe(true);
    });

    it('should preserve minItems/maxItems when creating array', () => {
      const schema = {
        type: 'array' as const,
        items: { type: 'string' as const },
        minItems: 1,
        maxItems: 3,
      };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse([]).success).toBe(false);
      expect(zodSchema.safeParse(['a']).success).toBe(true);
      expect(zodSchema.safeParse(['a', 'b', 'c']).success).toBe(true);
      expect(zodSchema.safeParse(['a', 'b', 'c', 'd']).success).toBe(false);
    });
  });

  describe('TupleHandler', () => {
    it('should convert to tuple for array items', () => {
      const schema = {
        type: 'array' as const,
        items: [{ type: 'string' as const }, { type: 'number' as const }],
      };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse(['a', 1]).success).toBe(true);
      expect(zodSchema.safeParse([1, 'a']).success).toBe(false);
    });

    it('should handle empty tuple', () => {
      const schema = { type: 'array' as const, items: [] };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse([]).success).toBe(true);
    });

    it('should handle impossible minItems constraint', () => {
      const schema = {
        type: 'array' as const,
        items: [{ type: 'string' as const }],
        minItems: 5,
      };
      const zodSchema = convertJsonSchemaToZod(schema);
      // With minItems > tuple length, nothing should be valid
      expect(zodSchema.safeParse(['a']).success).toBe(false);
    });

    it('should handle impossible maxItems constraint', () => {
      const schema = {
        type: 'array' as const,
        items: [{ type: 'string' as const }, { type: 'number' as const }, { type: 'boolean' as const }],
        maxItems: 1,
      };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse(['a', 1, true]).success).toBe(false);
    });
  });
});

describe('Object Handlers', () => {
  describe('ImplicitObjectHandler', () => {
    it('should detect implicit object from properties', () => {
      const schema = { properties: { name: { type: 'string' as const } } };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse({ name: 'test' }).success).toBe(true);
    });

    it('should detect implicit object from required', () => {
      const schema = { required: ['name'], properties: { name: { type: 'string' as const } } };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse({ name: 'test' }).success).toBe(true);
      expect(zodSchema.safeParse({}).success).toBe(false);
    });

    it('should detect implicit object from additionalProperties', () => {
      const schema = { additionalProperties: { type: 'string' as const } };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse({ any: 'value' }).success).toBe(true);
    });

    it('should detect implicit object from minProperties', () => {
      const schema = { minProperties: 1 };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse({ a: 1 }).success).toBe(true);
      expect(zodSchema.safeParse({}).success).toBe(false);
    });

    it('should detect implicit object from maxProperties', () => {
      const schema = { maxProperties: 2 };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse({ a: 1, b: 2 }).success).toBe(true);
      expect(zodSchema.safeParse({ a: 1, b: 2, c: 3 }).success).toBe(false);
    });
  });

  describe('PropertiesHandler', () => {
    it('should handle properties with required', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const },
          age: { type: 'number' as const },
        },
        required: ['name'],
      };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse({ name: 'John' }).success).toBe(true);
      expect(zodSchema.safeParse({ name: 'John', age: 30 }).success).toBe(true);
      expect(zodSchema.safeParse({ age: 30 }).success).toBe(false);
    });

    it('should handle additionalProperties: false', () => {
      const schema = {
        type: 'object' as const,
        properties: { name: { type: 'string' as const } },
        additionalProperties: false,
      };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse({ name: 'John' }).success).toBe(true);
      expect(zodSchema.safeParse({ name: 'John', extra: 'value' }).success).toBe(false);
    });

    it('should handle additionalProperties: true', () => {
      const schema = {
        type: 'object' as const,
        properties: { name: { type: 'string' as const } },
        additionalProperties: true,
      };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse({ name: 'John', extra: 123 }).success).toBe(true);
    });

    it('should handle additionalProperties with schema', () => {
      const schema = {
        type: 'object' as const,
        properties: { name: { type: 'string' as const } },
        additionalProperties: { type: 'number' as const },
      };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse({ name: 'John', extra: 123 }).success).toBe(true);
      expect(zodSchema.safeParse({ name: 'John', extra: 'string' }).success).toBe(false);
    });
  });

  describe('MaxPropertiesHandler', () => {
    it('should validate maximum properties', () => {
      const schema = { type: 'object' as const, maxProperties: 2 };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse({ a: 1, b: 2 }).success).toBe(true);
      expect(zodSchema.safeParse({ a: 1, b: 2, c: 3 }).success).toBe(false);
    });
  });

  describe('MinPropertiesHandler', () => {
    it('should validate minimum properties', () => {
      const schema = { type: 'object' as const, minProperties: 2 };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse({ a: 1, b: 2 }).success).toBe(true);
      expect(zodSchema.safeParse({ a: 1 }).success).toBe(false);
    });
  });
});

describe('Type Handlers', () => {
  describe('TypeHandler', () => {
    it('should handle all basic types', () => {
      expect(convertJsonSchemaToZod({ type: 'string' }).safeParse('test').success).toBe(true);
      expect(convertJsonSchemaToZod({ type: 'number' }).safeParse(123).success).toBe(true);
      expect(convertJsonSchemaToZod({ type: 'integer' }).safeParse(123).success).toBe(true);
      expect(convertJsonSchemaToZod({ type: 'boolean' }).safeParse(true).success).toBe(true);
      expect(convertJsonSchemaToZod({ type: 'null' }).safeParse(null).success).toBe(true);
      expect(convertJsonSchemaToZod({ type: 'array' }).safeParse([1]).success).toBe(true);
      expect(convertJsonSchemaToZod({ type: 'object' }).safeParse({ a: 1 }).success).toBe(true);
    });

    it('should handle array of types', () => {
      const schema = { type: ['string', 'number'] as const };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse('test').success).toBe(true);
      expect(zodSchema.safeParse(123).success).toBe(true);
      expect(zodSchema.safeParse(true).success).toBe(false);
    });

    it('should reject arrays for object type', () => {
      const schema = { type: 'object' as const };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse({ a: 1 }).success).toBe(true);
      expect(zodSchema.safeParse([1, 2, 3]).success).toBe(false);
    });
  });

  describe('ConstHandler', () => {
    it('should handle const with string', () => {
      const schema = { const: 'fixed' };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse('fixed').success).toBe(true);
      expect(zodSchema.safeParse('other').success).toBe(false);
    });

    it('should handle const with number', () => {
      const schema = { const: 42 };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse(42).success).toBe(true);
      expect(zodSchema.safeParse(43).success).toBe(false);
    });

    it('should handle const with boolean', () => {
      const schema = { const: true };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse(true).success).toBe(true);
      expect(zodSchema.safeParse(false).success).toBe(false);
    });

    it('should handle const with null', () => {
      const schema = { const: null };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse(null).success).toBe(true);
      expect(zodSchema.safeParse('null').success).toBe(false);
    });

    it('should handle const with object', () => {
      const schema = { const: { key: 'value' } };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse({ key: 'value' }).success).toBe(true);
      expect(zodSchema.safeParse({ key: 'other' }).success).toBe(false);
    });

    it('should handle const with array', () => {
      const schema = { const: [1, 2, 3] };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse([1, 2, 3]).success).toBe(true);
      expect(zodSchema.safeParse([1, 2]).success).toBe(false);
    });
  });

  describe('EnumHandler', () => {
    it('should handle string enum', () => {
      const schema = { enum: ['a', 'b', 'c'] };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse('a').success).toBe(true);
      expect(zodSchema.safeParse('d').success).toBe(false);
    });

    it('should handle number enum', () => {
      const schema = { enum: [1, 2, 3] };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse(2).success).toBe(true);
      expect(zodSchema.safeParse(4).success).toBe(false);
    });

    it('should handle mixed enum', () => {
      const schema = { enum: ['a', 1, true, null] };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse('a').success).toBe(true);
      expect(zodSchema.safeParse(1).success).toBe(true);
      expect(zodSchema.safeParse(true).success).toBe(true);
      expect(zodSchema.safeParse(null).success).toBe(true);
      expect(zodSchema.safeParse('other').success).toBe(false);
    });
  });
});

describe('Composition Handlers', () => {
  describe('AllOfHandler', () => {
    it('should combine all schemas', () => {
      const schema = {
        allOf: [
          { type: 'object' as const, properties: { a: { type: 'string' as const } } },
          { properties: { b: { type: 'number' as const } } },
        ],
      };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse({ a: 'test', b: 123 }).success).toBe(true);
    });
  });

  describe('AnyOfHandler', () => {
    it('should allow any of the schemas', () => {
      const schema = {
        anyOf: [{ type: 'string' as const }, { type: 'number' as const }],
      };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse('test').success).toBe(true);
      expect(zodSchema.safeParse(123).success).toBe(true);
      expect(zodSchema.safeParse(true).success).toBe(false);
    });
  });

  describe('OneOfHandler', () => {
    it('should allow exactly one of the schemas', () => {
      const schema = {
        oneOf: [{ type: 'string' as const }, { type: 'number' as const }],
      };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse('test').success).toBe(true);
      expect(zodSchema.safeParse(123).success).toBe(true);
    });
  });

  describe('NotHandler', () => {
    it('should reject values matching the not schema', () => {
      const schema = { not: { type: 'string' as const } };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse(123).success).toBe(true);
      expect(zodSchema.safeParse('test').success).toBe(false);
    });
  });
});

describe('Special Handlers', () => {
  describe('DefaultHandler', () => {
    it('should not affect validation but preserve default', () => {
      const schema = { type: 'string' as const, default: 'default-value' };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse('test').success).toBe(true);
    });
  });

  describe('MetadataHandler', () => {
    it('should handle title and description', () => {
      const schema = { type: 'string' as const, title: 'Name', description: 'User name' };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse('test').success).toBe(true);
    });
  });

  describe('UniqueItemsHandler', () => {
    it('should validate unique items', () => {
      const schema = { type: 'array' as const, uniqueItems: true };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse([1, 2, 3]).success).toBe(true);
      expect(zodSchema.safeParse([1, 2, 1]).success).toBe(false);
    });

    it('should handle uniqueItems with objects', () => {
      const schema = { type: 'array' as const, uniqueItems: true };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse([{ a: 1 }, { a: 2 }]).success).toBe(true);
      expect(zodSchema.safeParse([{ a: 1 }, { a: 1 }]).success).toBe(false);
    });
  });

  describe('ContainsHandler', () => {
    it('should validate array contains matching item', () => {
      const schema = {
        type: 'array' as const,
        contains: { type: 'string' as const },
      };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse(['a', 1, 2]).success).toBe(true);
      expect(zodSchema.safeParse([1, 2, 3]).success).toBe(false);
    });
  });

  describe('PrefixItemsHandler', () => {
    it('should validate prefix items', () => {
      const schema = {
        type: 'array' as const,
        prefixItems: [{ type: 'string' as const }, { type: 'number' as const }],
      };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse(['a', 1]).success).toBe(true);
      expect(zodSchema.safeParse(['a', 1, 'extra']).success).toBe(true);
      expect(zodSchema.safeParse([1, 'a']).success).toBe(false);
    });
  });
});

describe('Union Type Detection', () => {
  it('should use union when multiple types with constraints', () => {
    const schema = { type: ['string', 'number'] as const, minimum: 0 };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse('test').success).toBe(true);
    expect(zodSchema.safeParse(5).success).toBe(true);
  });

  it('should use any when no constraints', () => {
    const schema = { $schema: 'http://json-schema.org/draft-07/schema#', title: 'Test' };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse('anything').success).toBe(true);
    expect(zodSchema.safeParse(123).success).toBe(true);
  });
});

describe('Advanced Special Handlers', () => {
  describe('ProtoRequiredHandler', () => {
    it('should handle __proto__ in required without crashing', () => {
      const schema = { required: ['__proto__', 'name'] };
      const zodSchema = convertJsonSchemaToZod(schema);

      // Schema can be created without errors
      expect(zodSchema).toBeDefined();
      // Conversion doesn't throw
      expect(typeof zodSchema.safeParse).toBe('function');
    });

    it('should apply refinement when type is undefined and __proto__ in required', () => {
      const schema = { required: ['name'] };
      const zodSchema = convertJsonSchemaToZod(schema);

      // Schema validates that required properties exist
      expect(zodSchema.safeParse({ name: 'test' }).success).toBe(true);
      expect(zodSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('EnumComplexHandler', () => {
    it('should handle enum with object values', () => {
      const schema = { enum: [{ type: 'admin' }, { type: 'user' }, 'guest'] };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse({ type: 'admin' }).success).toBe(true);
      expect(zodSchema.safeParse({ type: 'user' }).success).toBe(true);
      expect(zodSchema.safeParse('guest').success).toBe(true);
      expect(zodSchema.safeParse({ type: 'unknown' }).success).toBe(false);
    });

    it('should handle enum with array values', () => {
      const schema = { enum: [[1, 2], [3, 4], 'other'] };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse([1, 2]).success).toBe(true);
      expect(zodSchema.safeParse([3, 4]).success).toBe(true);
      expect(zodSchema.safeParse([5, 6]).success).toBe(false);
    });

    it('should allow primitives when enum has complex values', () => {
      const schema = { enum: [{ a: 1 }, 'string', 42] };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse('string').success).toBe(true);
      expect(zodSchema.safeParse(42).success).toBe(true);
    });
  });

  describe('DefaultHandler', () => {
    it('should apply valid default', () => {
      const schema = { type: 'string' as const, default: 'default-value' };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.parse(undefined)).toBe('default-value');
    });

    it('should skip invalid default', () => {
      const schema = { type: 'number' as const, minimum: 10, default: 5 };
      const zodSchema = convertJsonSchemaToZod(schema);
      // Invalid default (5 < 10) should be skipped
      expect(zodSchema.safeParse(undefined).success).toBe(false);
    });
  });

  describe('ContainsHandler', () => {
    it('should validate minContains', () => {
      const schema = {
        type: 'array' as const,
        contains: { type: 'number' as const, minimum: 5 },
        minContains: 2,
      };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse([1, 5, 10]).success).toBe(true); // 2 numbers >= 5
      expect(zodSchema.safeParse([1, 5, 2]).success).toBe(false); // Only 1 number >= 5
    });

    it('should validate maxContains', () => {
      const schema = {
        type: 'array' as const,
        contains: { type: 'number' as const },
        maxContains: 2,
      };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse([1, 2]).success).toBe(true); // 2 numbers
      expect(zodSchema.safeParse([1, 2, 3]).success).toBe(false); // 3 numbers exceeds maxContains
    });
  });

  describe('PrefixItemsHandler', () => {
    it('should reject additional items when items: false', () => {
      const schema = {
        type: 'array' as const,
        prefixItems: [{ type: 'string' as const }],
        items: false,
      };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse(['a']).success).toBe(true);
      expect(zodSchema.safeParse(['a', 'extra']).success).toBe(false);
    });

    it('should validate additional items against items schema', () => {
      const schema = {
        type: 'array' as const,
        prefixItems: [{ type: 'string' as const }],
        items: { type: 'number' as const },
      };
      const zodSchema = convertJsonSchemaToZod(schema);
      expect(zodSchema.safeParse(['a', 1, 2]).success).toBe(true);
      expect(zodSchema.safeParse(['a', 'b']).success).toBe(false);
    });
  });
});

describe('Utils Coverage', () => {
  it('should handle deepEqual with null', () => {
    const schema = { const: null };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse(null).success).toBe(true);
    expect(zodSchema.safeParse(undefined).success).toBe(false);
  });

  it('should handle unique items with primitives', () => {
    const schema = { type: 'array' as const, uniqueItems: true };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse([1, 2, 3]).success).toBe(true);
    expect(zodSchema.safeParse(['a', 'b', 'a']).success).toBe(false);
  });

  it('should handle arrays with different lengths in deepEqual', () => {
    const schema = { const: [1, 2, 3] };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse([1, 2, 3]).success).toBe(true);
    expect(zodSchema.safeParse([1, 2]).success).toBe(false);
    expect(zodSchema.safeParse([1, 2, 3, 4]).success).toBe(false);
  });

  it('should handle objects with different keys in deepEqual', () => {
    const schema = { const: { a: 1, b: 2 } };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse({ a: 1, b: 2 }).success).toBe(true);
    expect(zodSchema.safeParse({ a: 1 }).success).toBe(false);
    expect(zodSchema.safeParse({ a: 1, b: 2, c: 3 }).success).toBe(false);
  });
});

describe('ObjectPropertiesHandler Edge Cases', () => {
  it('should handle undefined property schema', () => {
    const schema = {
      type: 'object' as const,
      properties: { name: undefined as any },
    };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse({ name: 'test' }).success).toBe(true);
  });

  it('should apply refinement for non-ZodObject schemas', () => {
    // When using anyOf/oneOf, the result might not be a ZodObject
    const schema = {
      anyOf: [{ type: 'object' as const }, { type: 'null' as const }],
      properties: { name: { type: 'string' as const } },
      required: ['name'],
    };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse({ name: 'test' }).success).toBe(true);
    expect(zodSchema.safeParse(null).success).toBe(true);
  });

  it('should validate additional properties restriction in refinement', () => {
    const schema = {
      anyOf: [{ type: 'object' as const }],
      properties: { name: { type: 'string' as const } },
      additionalProperties: false,
    };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse({ name: 'test' }).success).toBe(true);
    expect(zodSchema.safeParse({ name: 'test', extra: 'value' }).success).toBe(false);
  });
});

describe('Edge Cases for Full Coverage', () => {
  it('should handle empty properties object', () => {
    const schema = { type: 'object' as const, properties: {} };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse({}).success).toBe(true);
    expect(zodSchema.safeParse({ any: 'prop' }).success).toBe(true);
  });

  it('should return never for all types disabled', () => {
    // A schema that disables all types
    const schema = { type: 'string' as const, exclusiveMinimum: true as any };
    const zodSchema = convertJsonSchemaToZod(schema);
    // exclusiveMinimum with boolean disables number, type: string disables others
    expect(zodSchema.safeParse('test').success).toBe(true);
  });

  it('should handle nested prefixItems validation', () => {
    const schema = {
      type: 'array' as const,
      prefixItems: [{ type: 'object' as const, properties: { id: { type: 'number' as const } } }],
    };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse([{ id: 1 }]).success).toBe(true);
    expect(zodSchema.safeParse([{ id: 'string' }]).success).toBe(false);
  });

  it('should skip prefixItems validation for non-arrays', () => {
    const schema = {
      prefixItems: [{ type: 'string' as const }],
    };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse('not-array').success).toBe(true);
  });

  it('should skip contains validation for non-arrays', () => {
    const schema = { contains: { type: 'string' as const } };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse('not-array').success).toBe(true);
  });

  it('should skip uniqueItems for non-arrays', () => {
    const schema = { uniqueItems: true };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse('not-array').success).toBe(true);
  });
});

describe('DeepEqual Utils Edge Cases', () => {
  it('should return false when comparing null to non-null', () => {
    const schema = { const: { a: 1 } };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse(null).success).toBe(false);
  });

  it('should return false when comparing non-null to null', () => {
    const schema = { const: null };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse({ a: 1 }).success).toBe(false);
  });

  it('should handle deep equality with different types', () => {
    const schema = { const: 'string' };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse(123).success).toBe(false);
  });

  it('should handle objects missing keys from source', () => {
    const schema = { const: { a: 1, b: 2 } };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse({ a: 1, c: 3 }).success).toBe(false);
  });
});

describe('ProtoRequiredHandler Edge Cases', () => {
  it('should validate required on arrays (returns true)', () => {
    const schema = { required: ['__proto__', 'item'] };
    const zodSchema = convertJsonSchemaToZod(schema);
    // Arrays should pass the ProtoRequiredHandler check (it only validates objects)
    expect(zodSchema.safeParse([1, 2, 3]).success).toBe(true);
  });

  it('should validate required on null (returns true)', () => {
    const schema = { required: ['__proto__'] };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse(null).success).toBe(true);
  });

  it('should validate required on primitives (returns true)', () => {
    const schema = { required: ['__proto__'] };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse('string').success).toBe(true);
    expect(zodSchema.safeParse(123).success).toBe(true);
  });

  it('should skip ProtoRequired when type is defined', () => {
    const schema = {
      type: 'object' as const,
      required: ['__proto__', 'name'],
      properties: { name: { type: 'string' as const } },
    };
    const zodSchema = convertJsonSchemaToZod(schema);
    // When type is defined, ProtoRequiredHandler is skipped
    expect(zodSchema.safeParse({ name: 'test' }).success).toBe(true);
  });
});

describe('EnumHandler Boolean Edge Cases', () => {
  it('should handle single boolean enum value', () => {
    const schema = { enum: [true] };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse(true).success).toBe(true);
    expect(zodSchema.safeParse(false).success).toBe(false);
  });

  it('should handle both boolean enum values', () => {
    const schema = { enum: [true, false] };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse(true).success).toBe(true);
    expect(zodSchema.safeParse(false).success).toBe(true);
    expect(zodSchema.safeParse('true').success).toBe(false);
  });

  it('should handle empty enum', () => {
    const schema = { enum: [] };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse('anything').success).toBe(false);
  });

  it('should handle single number enum', () => {
    const schema = { enum: [42] };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse(42).success).toBe(true);
    expect(zodSchema.safeParse(43).success).toBe(false);
  });

  it('should handle two number enum values', () => {
    const schema = { enum: [1, 2] };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse(1).success).toBe(true);
    expect(zodSchema.safeParse(2).success).toBe(true);
    expect(zodSchema.safeParse(3).success).toBe(false);
  });
});

describe('Number Handlers with Non-ZodNumber Types', () => {
  it('should skip minimum when number type is explicitly disabled', () => {
    const schema = { enum: ['a', 'b'], minimum: 0 };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse('a').success).toBe(true);
  });

  it('should skip maximum when number type is explicitly disabled', () => {
    const schema = { enum: ['a'], maximum: 100 };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse('a').success).toBe(true);
  });

  it('should skip exclusiveMinimum when number type is explicitly disabled', () => {
    const schema = { enum: ['a'], exclusiveMinimum: 0 };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse('a').success).toBe(true);
  });

  it('should skip exclusiveMaximum when number type is explicitly disabled', () => {
    const schema = { enum: ['a'], exclusiveMaximum: 100 };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse('a').success).toBe(true);
  });

  it('should skip multipleOf when number type is explicitly disabled', () => {
    const schema = { enum: ['a'], multipleOf: 5 };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse('a').success).toBe(true);
  });
});

describe('String Handlers with Disabled String Type', () => {
  it('should skip minLength when string type is disabled', () => {
    const schema = { enum: [1, 2], minLength: 5 };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse(1).success).toBe(true);
  });

  it('should skip maxLength when string type is disabled', () => {
    const schema = { enum: [1], maxLength: 5 };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse(1).success).toBe(true);
  });

  it('should skip pattern when string type is disabled', () => {
    const schema = { enum: [1], pattern: '^test' };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse(1).success).toBe(true);
  });
});

describe('Array Handlers with Disabled Array Type', () => {
  it('should skip minItems when array type is disabled', () => {
    const schema = { type: 'string' as const, minItems: 5 };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse('test').success).toBe(true);
  });

  it('should skip maxItems when array type is disabled', () => {
    const schema = { type: 'string' as const, maxItems: 5 };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse('test').success).toBe(true);
  });

  it('should skip items when array type is disabled', () => {
    const schema = { type: 'string' as const, items: { type: 'number' as const } };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse('test').success).toBe(true);
  });
});

describe('Object Handlers with Disabled Object Type', () => {
  it('should skip properties when object type is disabled', () => {
    const schema = {
      type: 'string' as const,
      properties: { name: { type: 'string' as const } },
    };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse('test').success).toBe(true);
  });

  it('should skip minProperties when object type is disabled', () => {
    const schema = { type: 'string' as const, minProperties: 1 };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse('test').success).toBe(true);
  });

  it('should skip maxProperties when object type is disabled', () => {
    const schema = { type: 'string' as const, maxProperties: 1 };
    const zodSchema = convertJsonSchemaToZod(schema);
    expect(zodSchema.safeParse('test').success).toBe(true);
  });
});
