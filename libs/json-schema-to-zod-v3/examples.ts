/**
 * Comprehensive examples for json-schema-to-zod-v3
 *
 * This file demonstrates various use cases and patterns
 */

import { convertJsonSchemaToZod, jsonSchemaObjectToZodRawShape } from './src';
import { z } from 'zod';

// ============================================================================
// EXAMPLE 1: Basic String Schema
// ============================================================================
console.log('\n=== Example 1: Basic String Schema ===');

const stringSchema = {
  type: "string" as const,
  minLength: 5,
  maxLength: 100
};

const zodStringSchema = convertJsonSchemaToZod(stringSchema);
console.log('Valid:', zodStringSchema.safeParse("Hello World").success); // true
console.log('Invalid (too short):', zodStringSchema.safeParse("Hi").success); // false

// ============================================================================
// EXAMPLE 2: Number with Constraints
// ============================================================================
console.log('\n=== Example 2: Number with Constraints ===');

const numberSchema = {
  type: "number" as const,
  minimum: 0,
  maximum: 100,
  multipleOf: 5
};

const zodNumberSchema = convertJsonSchemaToZod(numberSchema);
console.log('Valid (15):', zodNumberSchema.safeParse(15).success); // true
console.log('Invalid (7):', zodNumberSchema.safeParse(7).success); // false (not multiple of 5)

// ============================================================================
// EXAMPLE 3: Enum Values
// ============================================================================
console.log('\n=== Example 3: Enum Values ===');

const enumSchema = {
  type: "string" as const,
  enum: ["pending", "active", "completed", "cancelled"]
};

const zodEnumSchema = convertJsonSchemaToZod(enumSchema);
console.log('Valid (active):', zodEnumSchema.safeParse("active").success); // true
console.log('Invalid (invalid):', zodEnumSchema.safeParse("invalid").success); // false

// ============================================================================
// EXAMPLE 4: Array with Constraints
// ============================================================================
console.log('\n=== Example 4: Array with Constraints ===');

const arraySchema = {
  type: "array" as const,
  items: { type: "number" as const, minimum: 0 },
  minItems: 1,
  maxItems: 5,
  uniqueItems: true
};

const zodArraySchema = convertJsonSchemaToZod(arraySchema);
console.log('Valid:', zodArraySchema.safeParse([1, 2, 3]).success); // true
console.log('Invalid (empty):', zodArraySchema.safeParse([]).success); // false
console.log('Invalid (duplicates):', zodArraySchema.safeParse([1, 2, 2]).success); // false

// ============================================================================
// EXAMPLE 5: Tuple
// ============================================================================
console.log('\n=== Example 5: Tuple ===');

const tupleSchema = {
  type: "array" as const,
  items: [
    { type: "string" as const },
    { type: "number" as const },
    { type: "boolean" as const }
  ]
};

const zodTupleSchema = convertJsonSchemaToZod(tupleSchema);
console.log('Valid:', zodTupleSchema.safeParse(["hello", 42, true]).success); // true
console.log('Invalid:', zodTupleSchema.safeParse([42, "hello", true]).success); // false

// ============================================================================
// EXAMPLE 6: Object with Required Fields
// ============================================================================
console.log('\n=== Example 6: Object with Required Fields ===');

const objectSchema = {
  type: "object" as const,
  properties: {
    name: { type: "string" as const, minLength: 1 },
    age: { type: "number" as const, minimum: 0, maximum: 120 },
    email: { type: "string" as const }
  },
  required: ["name", "email"]
};

const zodObjectSchema = convertJsonSchemaToZod(objectSchema);
console.log('Valid:', zodObjectSchema.safeParse({
  name: "John",
  email: "john@example.com",
  age: 30
}).success); // true

console.log('Invalid (missing email):', zodObjectSchema.safeParse({
  name: "John"
}).success); // false

// ============================================================================
// EXAMPLE 7: Using jsonSchemaObjectToZodRawShape
// ============================================================================
console.log('\n=== Example 7: Using jsonSchemaObjectToZodRawShape ===');

const userSchema = {
  type: "object" as const,
  properties: {
    username: {
      type: "string" as const,
      minLength: 3,
      maxLength: 20,
      pattern: "^[a-zA-Z0-9_]+$"
    },
    email: { type: "string" as const },
    age: { type: "number" as const }
  },
  required: ["username", "email"]
};

const shape = jsonSchemaObjectToZodRawShape(userSchema);
const zodUserSchema = z.object(shape);

console.log('Valid:', zodUserSchema.safeParse({
  username: "john_doe",
  email: "john@example.com",
  age: 25
}).success); // true

// ============================================================================
// EXAMPLE 8: anyOf (Union)
// ============================================================================
console.log('\n=== Example 8: anyOf (Union) ===');

const anyOfSchema = {
  anyOf: [
    { type: "string" as const },
    { type: "number" as const }
  ]
};

const zodAnyOfSchema = convertJsonSchemaToZod(anyOfSchema);
console.log('Valid (string):', zodAnyOfSchema.safeParse("hello").success); // true
console.log('Valid (number):', zodAnyOfSchema.safeParse(42).success); // true
console.log('Invalid (boolean):', zodAnyOfSchema.safeParse(true).success); // false

// ============================================================================
// EXAMPLE 9: allOf (Intersection)
// ============================================================================
console.log('\n=== Example 9: allOf (Intersection) ===');

const allOfSchema = {
  allOf: [
    {
      type: "object" as const,
      properties: {
        name: { type: "string" as const }
      }
    },
    {
      type: "object" as const,
      properties: {
        age: { type: "number" as const }
      }
    }
  ]
};

const zodAllOfSchema = convertJsonSchemaToZod(allOfSchema);
console.log('Valid:', zodAllOfSchema.safeParse({
  name: "Alice",
  age: 30
}).success); // true

// ============================================================================
// EXAMPLE 10: oneOf (Exactly One)
// ============================================================================
console.log('\n=== Example 10: oneOf (Exactly One) ===');

const oneOfSchema = {
  oneOf: [
    { type: "string" as const, minLength: 10 },
    { type: "number" as const, minimum: 100 }
  ]
};

const zodOneOfSchema = convertJsonSchemaToZod(oneOfSchema);
console.log('Valid (long string):', zodOneOfSchema.safeParse("hello world").success); // true
console.log('Valid (large number):', zodOneOfSchema.safeParse(150).success); // true
console.log('Invalid (short string):', zodOneOfSchema.safeParse("hi").success); // false

// ============================================================================
// EXAMPLE 11: not
// ============================================================================
console.log('\n=== Example 11: not ===');

const notSchema = {
  not: { type: "null" as const }
};

const zodNotSchema = convertJsonSchemaToZod(notSchema);
console.log('Valid (string):', zodNotSchema.safeParse("hello").success); // true
console.log('Valid (number):', zodNotSchema.safeParse(42).success); // true
console.log('Invalid (null):', zodNotSchema.safeParse(null).success); // false

// ============================================================================
// EXAMPLE 12: Nested Object
// ============================================================================
console.log('\n=== Example 12: Nested Object ===');

const nestedSchema = {
  type: "object" as const,
  properties: {
    user: {
      type: "object" as const,
      properties: {
        name: { type: "string" as const },
        address: {
          type: "object" as const,
          properties: {
            street: { type: "string" as const },
            city: { type: "string" as const }
          },
          required: ["city"]
        }
      },
      required: ["name"]
    }
  },
  required: ["user"]
};

const zodNestedSchema = convertJsonSchemaToZod(nestedSchema);
console.log('Valid:', zodNestedSchema.safeParse({
  user: {
    name: "John",
    address: {
      street: "123 Main St",
      city: "New York"
    }
  }
}).success); // true

// ============================================================================
// EXAMPLE 13: const Value
// ============================================================================
console.log('\n=== Example 13: const Value ===');

const constSchema = {
  type: "string" as const,
  const: "production"
};

const zodConstSchema = convertJsonSchemaToZod(constSchema);
console.log('Valid:', zodConstSchema.safeParse("production").success); // true
console.log('Invalid:', zodConstSchema.safeParse("development").success); // false

// ============================================================================
// EXAMPLE 14: Default Value
// ============================================================================
console.log('\n=== Example 14: Default Value ===');

const defaultSchema = {
  type: "string" as const,
  default: "hello"
};

const zodDefaultSchema = convertJsonSchemaToZod(defaultSchema);
const result = zodDefaultSchema.parse(undefined);
console.log('Default value:', result); // "hello"

// ============================================================================
// EXAMPLE 15: Real-World: User Registration
// ============================================================================
console.log('\n=== Example 15: Real-World User Registration ===');

const registrationSchema = {
  type: "object" as const,
  properties: {
    username: {
      type: "string" as const,
      minLength: 3,
      maxLength: 20,
      pattern: "^[a-zA-Z0-9_]+$"
    },
    email: {
      type: "string" as const,
      pattern: "^[^@]+@[^@]+\\.[^@]+$"
    },
    password: {
      type: "string" as const,
      minLength: 8
    },
    age: {
      type: "number" as const,
      minimum: 13,
      maximum: 120
    },
    terms: {
      type: "boolean" as const,
      const: true
    }
  },
  required: ["username", "email", "password", "terms"]
};

const zodRegistrationSchema = convertJsonSchemaToZod(registrationSchema);

const validRegistration = {
  username: "john_doe",
  email: "john@example.com",
  password: "secure123",
  age: 25,
  terms: true
};

console.log('Valid registration:', zodRegistrationSchema.safeParse(validRegistration).success);

// ============================================================================
// EXAMPLE 16: Real-World: API Response
// ============================================================================
console.log('\n=== Example 16: Real-World API Response ===');

const apiResponseSchema = {
  type: "object" as const,
  properties: {
    status: {
      type: "string" as const,
      enum: ["success", "error"]
    },
    data: {
      anyOf: [
        { type: "object" as const },
        { type: "array" as const },
        { type: "null" as const }
      ]
    },
    error: {
      type: "object" as const,
      properties: {
        code: { type: "string" as const },
        message: { type: "string" as const }
      }
    },
    timestamp: {
      type: "string" as const
    }
  },
  required: ["status"]
};

const zodApiResponseSchema = convertJsonSchemaToZod(apiResponseSchema);

const successResponse = {
  status: "success",
  data: { id: 1, name: "Item" },
  timestamp: "2024-01-01T00:00:00Z"
};

console.log('Valid API response:', zodApiResponseSchema.safeParse(successResponse).success);

// ============================================================================
// EXAMPLE 17: prefixItems with additional items
// ============================================================================
console.log('\n=== Example 17: prefixItems with additional items ===');

const prefixItemsSchema = {
  type: "array" as const,
  prefixItems: [
    { type: "string" as const },
    { type: "number" as const }
  ],
  items: { type: "boolean" as const }
};

const zodPrefixItemsSchema = convertJsonSchemaToZod(prefixItemsSchema);
console.log('Valid:', zodPrefixItemsSchema.safeParse(["hello", 42, true, false]).success); // true
console.log('Invalid:', zodPrefixItemsSchema.safeParse([42, "hello"]).success); // false

// ============================================================================
// EXAMPLE 18: contains with minContains/maxContains
// ============================================================================
console.log('\n=== Example 18: contains with minContains/maxContains ===');

const containsSchema = {
  type: "array" as const,
  items: { type: "number" as const },
  contains: { type: "number" as const, minimum: 5 },
  minContains: 2,
  maxContains: 4
};

const zodContainsSchema = convertJsonSchemaToZod(containsSchema);
console.log('Valid (3 matching):', zodContainsSchema.safeParse([1, 2, 5, 10, 15]).success); // true
console.log('Invalid (1 matching):', zodContainsSchema.safeParse([1, 2, 5]).success); // false

console.log('\n=== All Examples Completed ===\n');
