---
name: basic-openapi-adapter
reference: openapi-adapter
level: basic
description: 'Demonstrates converting an OpenAPI specification into MCP tools automatically using `OpenapiAdapter` with minimal configuration.'
tags: [development, openapi, adapters, adapter]
features:
  - 'Using `OpenapiAdapter.init()` with just `name` and `url` to auto-generate MCP tools'
  - 'Each OpenAPI operation becomes a tool named `<adapter-name>:<operationId>`'
  - 'The adapter is registered in the `adapters` array of `@App`, not in `plugins`'
  - 'The `name` field serves as the namespace prefix to prevent tool name collisions'
---

# Basic OpenAPI Adapter

Demonstrates converting an OpenAPI specification into MCP tools automatically using `OpenapiAdapter` with minimal configuration.

## Code

```typescript
// src/server.ts
import { FrontMcp, App } from '@frontmcp/sdk';
import { OpenapiAdapter } from '@frontmcp/adapters';

@App({
  name: 'petstore',
  adapters: [
    OpenapiAdapter.init({
      name: 'petstore',
      url: 'https://petstore3.swagger.io/api/v3/openapi.json',
    }),
  ],
})
class PetstoreApp {}

@FrontMcp({
  info: { name: 'petstore-server', version: '1.0.0' },
  apps: [PetstoreApp],
  http: { port: 3000 },
})
class MyServer {}
// Generated tools: petstore:addPet, petstore:getPetById, petstore:deletePet, etc.
```

## What This Demonstrates

- Using `OpenapiAdapter.init()` with just `name` and `url` to auto-generate MCP tools
- Each OpenAPI operation becomes a tool named `<adapter-name>:<operationId>`
- The adapter is registered in the `adapters` array of `@App`, not in `plugins`
- The `name` field serves as the namespace prefix to prevent tool name collisions

## Related

- See `openapi-adapter` for authentication, filtering, transforms, and security options
