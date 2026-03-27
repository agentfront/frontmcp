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
