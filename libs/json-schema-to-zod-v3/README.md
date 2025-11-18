# JSON Schema to Zod v3 Converter

A production-ready TypeScript library for converting JSON Schema (Draft 7+) to Zod v3 validation schemas with full type safety and comprehensive feature support.

## Features

✅ **Full Zod v3 Support** - Works seamlessly with Zod 3.x  
✅ **Comprehensive JSON Schema Support** - All major features from Draft 7+  
✅ **Type Safe** - Full TypeScript support with proper type inference  
✅ **Well Documented** - Every function and handler has detailed JSDoc comments  
✅ **Production Ready** - Clean architecture, proper error handling, and edge case coverage  
✅ **Zero Dependencies** - Only peer dependency is Zod v3

## Installation

Install the package from npm along with Zod v3:

```bash
npm install json-schema-to-zod-v3 zod@^3.23.8
```

Or using yarn:

```bash
yarn add json-schema-to-zod-v3 zod@^3.23.8
```

Or using pnpm:

```bash
pnpm add json-schema-to-zod-v3 zod@^3.23.8
```

## Quick Start

```typescript
import { convertJsonSchemaToZod } from 'json-schema-to-zod-v3';
import { z } from 'zod';

// Define a JSON Schema
const jsonSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1 },
    age: { type: "number", minimum: 0, maximum: 120 },
    email: { type: "string", pattern: "^[^@]+@[^@]+\\.[^@]+$" }
  },
  required: ["name", "email"]
};

// Convert to Zod schema
const zodSchema = convertJsonSchemaToZod(jsonSchema);

// Use for validation
const result = zodSchema.safeParse({
  name: "John Doe",
  email: "john@example.com",
  age: 30
});

console.log(result.success); // true
```

## API Reference

### `convertJsonSchemaToZod(schema)`

Main conversion function that transforms any JSON Schema to a Zod schema.

**Parameters:**
- `schema: JSONSchema` - JSON Schema object or boolean

**Returns:** `z.ZodTypeAny` - Zod schema equivalent

**Example:**
```typescript
import { convertJsonSchemaToZod } from 'json-schema-to-zod-v3';

const zodSchema = convertJsonSchemaToZod({
  type: "string",
  minLength: 5,
  maxLength: 100,
  pattern: "^[A-Z]"
});
```

### `jsonSchemaObjectToZodRawShape(schema)`

Convenience function for converting object schemas to Zod object shapes.

**Parameters:**
- `schema: JSONSchemaObject` - JSON Schema object with properties

**Returns:** `Record<string, z.ZodTypeAny>` - Object shape for z.object()

**Example:**
```typescript
import { jsonSchemaObjectToZodRawShape } from 'json-schema-to-zod-v3';
import { z } from 'zod';

const shape = jsonSchemaObjectToZodRawShape({
  type: "object",
  properties: {
    username: { type: "string" },
    age: { type: "number" }
  },
  required: ["username"]
});

const schema = z.object(shape);
```

### Utility Functions

#### `isValidWithSchema(schema, value)`

Validates a value against a Zod schema.

```typescript
import { isValidWithSchema } from 'json-schema-to-zod-v3';
import { z } from 'zod';

const schema = z.string();
isValidWithSchema(schema, "hello"); // true
isValidWithSchema(schema, 123);     // false
```

#### `createUniqueItemsValidator()`

Creates a validator for unique array items with deep equality.

```typescript
import { createUniqueItemsValidator } from 'json-schema-to-zod-v3';

const validator = createUniqueItemsValidator();
validator([1, 2, 3]); // true
validator([1, 2, 1]); // false
```

#### `deepEqual(a, b)`

Performs deep equality comparison.

```typescript
import { deepEqual } from 'json-schema-to-zod-v3';

deepEqual({ a: 1, b: [2, 3] }, { a: 1, b: [2, 3] }); // true
```

## Supported JSON Schema Features

### Type Keywords

| Feature | Support | Example |
|---------|---------|---------|
| `type` | ✅ | `{ "type": "string" }` |
| `type` (multiple) | ✅ | `{ "type": ["string", "number"] }` |
| `const` | ✅ | `{ "const": "fixed-value" }` |
| `enum` | ✅ | `{ "enum": ["a", "b", "c"] }` |

### String Constraints

```typescript
{
  type: "string",
  minLength: 5,      // ✅ Minimum length
  maxLength: 100,    // ✅ Maximum length
  pattern: "^[A-Z]"  // ✅ Regular expression
}
```

### Number Constraints

```typescript
{
  type: "number",
  minimum: 0,              // ✅ Minimum value (inclusive)
  maximum: 100,            // ✅ Maximum value (inclusive)
  exclusiveMinimum: 0,     // ✅ Exclusive minimum
  exclusiveMaximum: 100,   // ✅ Exclusive maximum
  multipleOf: 5            // ✅ Must be multiple of
}
```

### Array Constraints

```typescript
{
  type: "array",
  items: { type: "string" },  // ✅ All items schema
  minItems: 1,                // ✅ Minimum length
  maxItems: 10,               // ✅ Maximum length
  uniqueItems: true,          // ✅ All items unique
  contains: { type: "number" }, // ✅ Must contain matching items
  prefixItems: [              // ✅ Tuple prefix
    { type: "string" },
    { type: "number" }
  ]
}
```

### Tuple Support

```typescript
{
  type: "array",
  items: [
    { type: "string" },
    { type: "number" },
    { type: "boolean" }
  ]
}
// Converts to: z.tuple([z.string(), z.number(), z.boolean()])
```

### Object Constraints

```typescript
{
  type: "object",
  properties: {              // ✅ Property schemas
    name: { type: "string" }
  },
  required: ["name"],        // ✅ Required fields
  additionalProperties: false, // ✅ No extra properties
  minProperties: 1,          // ✅ Minimum property count
  maxProperties: 10          // ✅ Maximum property count
}
```

### Composition Keywords

#### allOf (Intersection)
```typescript
{
  allOf: [
    { type: "object", properties: { name: { type: "string" } } },
    { type: "object", properties: { age: { type: "number" } } }
  ]
}
// Must match ALL schemas
```

#### anyOf (Union)
```typescript
{
  anyOf: [
    { type: "string" },
    { type: "number" }
  ]
}
// Must match AT LEAST ONE schema
```

#### oneOf (Exclusive)
```typescript
{
  oneOf: [
    { type: "string", minLength: 5 },
    { type: "number", minimum: 100 }
  ]
}
// Must match EXACTLY ONE schema
```

#### not (Negation)
```typescript
{
  not: { type: "null" }
}
// Must NOT match the schema
```

### Other Features

- ✅ `default` - Default values
- ✅ `description` - Schema descriptions
- ✅ Complex `const` and `enum` (objects/arrays)
- ✅ Boolean schemas (`true`/`false`)
- ✅ Implicit type detection

## Examples

### User Registration Schema

```typescript
import { convertJsonSchemaToZod } from 'json-schema-to-zod-v3';

const registrationSchema = {
  type: "object",
  properties: {
    username: {
      type: "string",
      minLength: 3,
      maxLength: 20,
      pattern: "^[a-zA-Z0-9_]+$"
    },
    email: {
      type: "string",
      pattern: "^[^@]+@[^@]+\\.[^@]+$"
    },
    password: {
      type: "string",
      minLength: 8
    },
    age: {
      type: "number",
      minimum: 13,
      maximum: 120
    },
    terms: {
      type: "boolean",
      const: true
    }
  },
  required: ["username", "email", "password", "terms"]
};

const zodSchema = convertJsonSchemaToZod(registrationSchema);

// Use it
const result = zodSchema.safeParse({
  username: "john_doe",
  email: "john@example.com",
  password: "secure123",
  age: 25,
  terms: true
});
```

### API Response Schema

```typescript
import { convertJsonSchemaToZod } from 'json-schema-to-zod-v3';

const responseSchema = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: ["success", "error"]
    },
    data: {
      anyOf: [
        { type: "object" },
        { type: "array" },
        { type: "null" }
      ]
    },
    error: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" }
      }
    }
  },
  required: ["status"]
};

const zodSchema = convertJsonSchemaToZod(responseSchema);
```

### Product Catalog Schema

```typescript
import { convertJsonSchemaToZod } from 'json-schema-to-zod-v3';

const productSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string", minLength: 1 },
    price: { 
      type: "number", 
      minimum: 0, 
      multipleOf: 0.01 
    },
    category: {
      type: "string",
      enum: ["electronics", "clothing", "books"]
    },
    tags: {
      type: "array",
      items: { type: "string" },
      uniqueItems: true,
      minItems: 1
    },
    metadata: {
      type: "object",
      properties: {
        createdAt: { type: "string" },
        updatedAt: { type: "string" }
      },
      required: ["createdAt"]
    }
  },
  required: ["id", "name", "price", "category"]
};

const zodSchema = convertJsonSchemaToZod(productSchema);
```

### Working with OpenAPI Specs

If you have an OpenAPI specification, you can extract JSON Schemas and convert them:

```typescript
import { convertJsonSchemaToZod } from 'json-schema-to-zod-v3';

// Example: Extract schema from OpenAPI
const openApiSpec = {
  components: {
    schemas: {
      User: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" }
        },
        required: ["id", "name"]
      }
    }
  }
};

// Convert the User schema
const userZodSchema = convertJsonSchemaToZod(
  openApiSpec.components.schemas.User
);
```

## Architecture

The library uses a clean, modular architecture:

```
src/
├── index.ts                    # Public API
├── types.ts                    # TypeScript type definitions
├── utils.ts                    # Utility functions
├── converter.ts                # Main conversion orchestrator
└── handlers/
    ├── primitive/              # Primitive type handlers
    │   ├── basic.ts           # Type, const, enum
    │   ├── string.ts          # String constraints
    │   ├── number.ts          # Number constraints
    │   ├── array.ts           # Array constraints
    │   └── object.ts          # Object constraints
    └── refinement/            # Refinement handlers
        ├── composition.ts     # allOf, anyOf, oneOf, not
        ├── complex.ts         # Advanced array/object features
        └── special.ts         # Edge cases and metadata
```

### Conversion Process

1. **Primitive Phase**: Handlers build base type schemas
2. **Collection Phase**: Gather all allowed type schemas
3. **Combination Phase**: Create union if multiple types
4. **Refinement Phase**: Apply constraints and validations

## TypeScript Support

The library is fully typed with TypeScript:

```typescript
import { JSONSchemaObject, convertJsonSchemaToZod } from 'json-schema-to-zod-v3';

const schema: JSONSchemaObject = {
  type: "object",
  properties: {
    name: { type: "string" }
  }
};

// Type-safe conversion
const zodSchema = convertJsonSchemaToZod(schema);
// Type is inferred as z.ZodTypeAny
```

## Edge Cases Handled

- ✅ Empty enum arrays
- ✅ Boolean schemas (true/false)
- ✅ `__proto__` in required fields
- ✅ Conflicting constraints
- ✅ Unicode/emoji in string length
- ✅ Floating-point precision in multipleOf
- ✅ Deep equality for complex types

## Limitations

- `$ref` references must be resolved before conversion
- Some very advanced JSON Schema features may not be supported
- Maximum recursion depth applies to nested schemas

## Performance

The library is optimized for production use:
- Handlers execute in optimal order
- Minimal object allocation
- No unnecessary schema wrapping

## Migration from Zod v4

If you're coming from a Zod v4 library, the main difference is the import:

```typescript
// Old (Zod v4)
import { z } from "zod/v4";

// New (Zod v3)
import { z } from "zod";
```

All other functionality remains the same.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

If you encounter any issues or have questions:
1. Check the examples in this README
2. Open an issue on GitHub
3. Refer to the [Zod documentation](https://zod.dev) for Zod-specific questions

## License

MIT

## Related Projects

- [Zod](https://github.com/colinhacks/zod) - TypeScript-first schema validation
- [JSON Schema](https://json-schema.org/) - JSON Schema specification

## Changelog

### 1.0.0
- Initial release
- Full Zod v3 support
- Comprehensive JSON Schema Draft 7+ support
- Production-ready with full documentation
