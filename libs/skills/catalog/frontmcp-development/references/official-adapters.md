---
name: official-adapters
description: Overview of all official FrontMCP adapters that convert external definitions into MCP primitives
---

# Official Adapters

Adapters convert external definitions (OpenAPI specs, Lambda functions, etc.) into MCP tools, resources, and prompts automatically. They are registered in the `adapters` array of `@App`.

## When to Use This Skill

### Must Use

- Integrating an external API or service that has a machine-readable specification
- Auto-generating MCP tools from an API definition instead of writing them manually

### Recommended

- Registering multiple external APIs as namespaced tool sets in a single server
- Setting up authentication, polling, or transforms for adapter-generated tools

### Skip When

- The external API has no machine-readable spec and uses a custom protocol (see `create-adapter`)
- You need cross-cutting behavior like caching or logging (see `create-plugin` or `official-plugins`)
- You are building tools manually without an external spec (see `create-tool`)

> **Decision:** Use this skill when you have an external API definition and want to automatically generate MCP primitives from it.

## Available Adapters

| Adapter             | Package              | Description                                                                                                                                                                      | Dedicated Skill                         |
| ------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **OpenAPI Adapter** | `@frontmcp/adapters` | Converts OpenAPI 3.x specifications into MCP tools — one tool per operation. Supports authentication, spec polling, filtering, transforms, format resolution, and $ref security. | [`openapi-adapter`](openapi-adapter.md) |

> More adapters will be added in future releases. To build a custom adapter for a non-OpenAPI source, see `create-adapter`.

## Quick Start

```typescript
import { OpenapiAdapter } from '@frontmcp/adapters';

@App({
  name: 'MyApp',
  adapters: [
    OpenapiAdapter.init({
      name: 'petstore',
      url: 'https://petstore3.swagger.io/api/v3/openapi.json',
    }),
  ],
})
class MyApp {}
// Generated tools: petstore:addPet, petstore:getPetById, petstore:deletePet, etc.
```

For full configuration, authentication, security, and advanced features, see the [`openapi-adapter`](openapi-adapter.md) reference.

## Adapter vs Plugin

| Aspect      | Adapter                              | Plugin                              |
| ----------- | ------------------------------------ | ----------------------------------- |
| Purpose     | Generate tools from external sources | Add cross-cutting behavior          |
| Output      | Tools, resources, prompts            | Lifecycle hooks, context extensions |
| Examples    | OpenAPI → MCP tools                  | Caching, auth, logging              |
| When to use | Integrating APIs                     | Adding middleware                   |

## Common Patterns

| Pattern              | Correct                                                                      | Incorrect                                    | Why                                                                      |
| -------------------- | ---------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| Adapter registration | `OpenapiAdapter.init({ ... })` in `adapters` array                           | Placing adapter in `plugins` array           | Adapters go in `adapters`, not `plugins`; they serve different purposes  |
| Tool naming          | Tools auto-named as `<name>:<operationId>` using adapter `name` as namespace | Expecting flat names like `listPets`         | Adapter name is prepended to prevent collisions across multiple adapters |
| Multiple APIs        | Register separate `OpenapiAdapter.init()` calls with unique `name` values    | Using the same `name` for different adapters | Duplicate names cause tool naming collisions                             |

## Reference

- [`openapi-adapter`](openapi-adapter.md) — Full OpenAPI adapter reference
- `create-adapter` — Build a custom adapter for non-OpenAPI sources
- `create-plugin` — Build plugins for cross-cutting concerns
- [Adapter Overview Documentation](https://docs.agentfront.dev/frontmcp/adapters/overview)
