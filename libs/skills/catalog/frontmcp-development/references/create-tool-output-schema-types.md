---
name: create-tool-output-schema-types
description: Reference for all supported outputSchema types including Zod shapes and JSON Schema
---

# Output Schema Types Reference

All supported `outputSchema` types for `@Tool`:

## Zod Raw Shapes (Recommended)

```typescript
outputSchema: {
  name: z.string(),
  count: z.number(),
  items: z.array(z.string()),
}
```

Produces structured JSON output. **Best practice for CodeCall compatibility and data leak prevention.**

## Zod Schemas

```typescript
outputSchema: z.object({ result: z.number() })
outputSchema: z.array(z.string())
outputSchema: z.union([z.string(), z.number()])
outputSchema: z.discriminatedUnion('type', [...])
```

## Primitive Literals

```typescript
outputSchema: 'string'; // Returns plain text
outputSchema: 'number'; // Returns a number
outputSchema: 'boolean'; // Returns true/false
outputSchema: 'date'; // Returns an ISO date string
```

## Media Types

```typescript
outputSchema: 'image'; // Returns base64 image data
outputSchema: 'audio'; // Returns base64 audio data
outputSchema: 'resource'; // Returns a resource content
outputSchema: 'resource_link'; // Returns a resource URI link
```

## Multi-Content Arrays

```typescript
outputSchema: ['string', 'image']; // Returns text + image content
```

## No OutputSchema (Not Recommended)

When `outputSchema` is omitted, the tool returns unvalidated content. This:

- Risks leaking internal fields to the client
- Prevents CodeCall from inferring return types
- Loses compile-time type checking on `Out` generic

## Examples

| Example                                                                                                     | Level        | Description                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`primitive-and-media-outputs`](../examples/create-tool-output-schema-types/primitive-and-media-outputs.md) | Intermediate | Demonstrates using primitive string literals and media types as `outputSchema` for tools that return plain text, images, or multi-content arrays.              |
| [`zod-raw-shape-output`](../examples/create-tool-output-schema-types/zod-raw-shape-output.md)               | Basic        | Demonstrates the recommended approach of using a Zod raw shape as `outputSchema` for structured, validated JSON output.                                        |
| [`zod-schema-advanced-output`](../examples/create-tool-output-schema-types/zod-schema-advanced-output.md)   | Advanced     | Demonstrates using full Zod schema objects (not raw shapes) as `outputSchema`, including `z.object()`, `z.array()`, `z.union()`, and `z.discriminatedUnion()`. |

> See all examples in [`examples/create-tool-output-schema-types/`](../examples/create-tool-output-schema-types/)
