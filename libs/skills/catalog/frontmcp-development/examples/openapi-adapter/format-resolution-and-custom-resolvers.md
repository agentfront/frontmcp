---
name: format-resolution-and-custom-resolvers
reference: openapi-adapter
level: intermediate
description: 'Demonstrates using built-in and custom format resolvers to enrich tool input schemas with concrete constraints from OpenAPI format values.'
tags: [development, openapi, adapters, format, schema, validation]
features:
  - 'Enabling built-in format resolvers with `resolveFormats: true` for uuid, date-time, email, int32, etc.'
  - 'Adding custom format resolvers for domain-specific formats (phone, currency)'
  - 'Merging custom resolvers with built-ins where custom takes precedence'
  - 'Using custom-only resolvers without built-ins for full control'
---

# Format Resolution and Custom Resolvers

Demonstrates using built-in and custom format resolvers to enrich tool input schemas with concrete constraints from OpenAPI format values.

## Code

```typescript
// src/server.ts
import { FrontMcp, App } from '@frontmcp/sdk';
import { OpenapiAdapter } from '@frontmcp/adapters';

@App({
  name: 'format-demo',
  adapters: [
    // Built-in format resolvers only
    // uuid fields get regex patterns, date-time gets ISO 8601 format,
    // int32 gets min/max constraints, email gets validation pattern
    OpenapiAdapter.init({
      name: 'users-api',
      url: 'https://api.example.com/openapi.json',
      baseUrl: 'https://api.example.com',
      generateOptions: {
        resolveFormats: true,
      },
    }),

    // Built-in + custom format resolvers
    // Custom resolvers are merged with built-ins; custom takes precedence
    OpenapiAdapter.init({
      name: 'payments-api',
      url: 'https://payments.example.com/openapi.json',
      baseUrl: 'https://payments.example.com',
      generateOptions: {
        resolveFormats: true,
        formatResolvers: {
          // Domain-specific formats
          phone: (schema) => ({
            ...schema,
            pattern: '^\\+[1-9]\\d{1,14}$',
            description: 'E.164 international phone number (e.g., +14155552671)',
          }),
          currency: (schema) => ({
            ...schema,
            pattern: '^[A-Z]{3}$',
            description: 'ISO 4217 currency code (e.g., USD, EUR, GBP)',
          }),
          'country-code': (schema) => ({
            ...schema,
            pattern: '^[A-Z]{2}$',
            description: 'ISO 3166-1 alpha-2 country code (e.g., US, GB, DE)',
          }),
        },
      },
    }),

    // Custom resolvers only (no built-ins)
    // Only the formats you explicitly define are resolved
    OpenapiAdapter.init({
      name: 'legacy-api',
      url: 'https://legacy.example.com/openapi.json',
      baseUrl: 'https://legacy.example.com',
      generateOptions: {
        // Without resolveFormats: true, only custom resolvers apply
        formatResolvers: {
          'social-security': (schema) => ({
            ...schema,
            pattern: '^\\d{3}-\\d{2}-\\d{4}$',
            description: 'US Social Security Number (XXX-XX-XXXX)',
          }),
        },
      },
    }),
  ],
})
class FormatDemoApp {}

@FrontMcp({
  info: { name: 'format-demo-server', version: '1.0.0' },
  apps: [FormatDemoApp],
  http: { port: 3000 },
})
class MyServer {}
```

## What This Demonstrates

- Enabling built-in format resolvers with `resolveFormats: true` for uuid, date-time, email, int32, etc.
- Adding custom format resolvers for domain-specific formats (phone, currency)
- Merging custom resolvers with built-ins where custom takes precedence
- Using custom-only resolvers without built-ins for full control

## Related

- See `openapi-adapter` for all generate options, authentication, and $ref security
- See `create-tool` for building tools with manual schema definitions
