---
name: official-adapters
description: Use the OpenAPI adapter to convert REST APIs into MCP tools automatically. Use when integrating external APIs, OpenAPI specs, or converting Swagger docs to MCP tools.
tags: [adapters, openapi, rest-api, swagger, integration]
priority: 7
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/adapters/overview
---

# Official Adapters

Adapters convert external definitions (OpenAPI specs, Lambda functions, etc.) into MCP tools, resources, and prompts automatically.

## When to Use This Skill

### Must Use

- Converting an OpenAPI/Swagger specification into MCP tools automatically
- Integrating a REST API that provides a public OpenAPI spec (Petstore, GitHub, Jira, Slack)
- Setting up authentication (API key, bearer token, OAuth) for an adapter-generated API integration

### Recommended

- Registering multiple external APIs as namespaced tool sets in a single server
- Enabling spec polling to auto-refresh tool definitions when the upstream API changes
- Providing an inline OpenAPI spec for APIs without a hosted spec URL

### Skip When

- The external API has no OpenAPI spec and uses a custom protocol (see `create-adapter`)
- You need cross-cutting behavior like caching or logging (see `create-plugin` or `official-plugins`)
- You are building tools manually without an external spec (see `create-tool`)

> **Decision:** Use this skill when you have an OpenAPI/Swagger spec and want to automatically generate MCP tools from it using `OpenApiAdapter`.

## OpenAPI Adapter

The primary official adapter. Converts OpenAPI/Swagger specifications into MCP tools — one tool per operation.

### Installation

```typescript
import { OpenApiAdapter } from '@frontmcp/adapters';

@App({
  name: 'MyApp',
  adapters: [
    OpenApiAdapter.init({
      name: 'petstore',
      specUrl: 'https://petstore3.swagger.io/api/v3/openapi.json',
    }),
  ],
})
class MyApp {}
```

Each OpenAPI operation becomes an MCP tool named `petstore:operationId`.

### With Authentication

```typescript
// API Key auth
OpenApiAdapter.init({
  name: 'my-api',
  specUrl: 'https://api.example.com/openapi.json',
  auth: {
    type: 'apiKey',
    headerName: 'X-API-Key',
    apiKey: process.env.API_KEY!,
  },
});

// Bearer token auth
OpenApiAdapter.init({
  name: 'my-api',
  specUrl: 'https://api.example.com/openapi.json',
  auth: {
    type: 'bearer',
    token: process.env.API_TOKEN!,
  },
});

// OAuth auth
OpenApiAdapter.init({
  name: 'my-api',
  specUrl: 'https://api.example.com/openapi.json',
  auth: {
    type: 'oauth',
    tokenUrl: 'https://auth.example.com/token',
    clientId: process.env.CLIENT_ID!,
    clientSecret: process.env.CLIENT_SECRET!,
    scopes: ['read', 'write'],
  },
});
```

### Spec Polling

Automatically refresh the OpenAPI spec at intervals:

```typescript
OpenApiAdapter.init({
  name: 'evolving-api',
  specUrl: 'https://api.example.com/openapi.json',
  polling: {
    intervalMs: 300000, // Re-fetch every 5 minutes
  },
});
```

### Inline Spec

Provide the OpenAPI spec directly instead of fetching from URL:

```typescript
OpenApiAdapter.init({
  name: 'my-api',
  spec: {
    openapi: '3.0.0',
    info: { title: 'My API', version: '1.0.0' },
    paths: { ... },
  },
})
```

### Multiple Adapters

Register adapters from different APIs in the same app:

```typescript
@App({
  name: 'IntegrationHub',
  adapters: [
    OpenApiAdapter.init({ name: 'github', specUrl: 'https://api.github.com/openapi.json' }),
    OpenApiAdapter.init({ name: 'jira', specUrl: 'https://jira.example.com/openapi.json' }),
    OpenApiAdapter.init({ name: 'slack', specUrl: 'https://slack.com/openapi.json' }),
  ],
})
class IntegrationHub {}
// Tools: github:createIssue, jira:createTicket, slack:postMessage, etc.
```

## Adapter vs Plugin

| Aspect      | Adapter                              | Plugin                              |
| ----------- | ------------------------------------ | ----------------------------------- |
| Purpose     | Generate tools from external sources | Add cross-cutting behavior          |
| Output      | Tools, resources, prompts            | Lifecycle hooks, context extensions |
| Examples    | OpenAPI → MCP tools                  | Caching, auth, logging              |
| When to use | Integrating APIs                     | Adding middleware                   |

## Common Patterns

| Pattern              | Correct                                                                         | Incorrect                                                       | Why                                                                                  |
| -------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Adapter registration | `OpenApiAdapter.init({ name: 'petstore', specUrl: '...' })` in `adapters` array | Placing adapter in `plugins` array                              | Adapters go in `adapters`, not `plugins`; they serve different purposes              |
| Tool naming          | Tools auto-named as `petstore:operationId` using adapter `name` as namespace    | Expecting flat names like `listPets`                            | Adapter name is prepended to prevent collisions across multiple adapters             |
| Auth configuration   | `auth: { type: 'bearer', token: process.env.API_TOKEN! }`                       | Hardcoding secrets: `auth: { type: 'bearer', token: 'sk-xxx' }` | Always use environment variables for secrets; never commit tokens                    |
| Spec source          | Use `specUrl` for hosted specs or `spec` for inline definitions                 | Using both `specUrl` and `spec` simultaneously                  | Only one source should be provided; `spec` takes precedence and `specUrl` is ignored |
| Multiple APIs        | Register separate `OpenApiAdapter.init()` calls with unique `name` values       | Using the same `name` for different adapters                    | Duplicate names cause tool naming collisions                                         |

## Verification Checklist

### Configuration

- [ ] `@frontmcp/adapters` package is installed
- [ ] `OpenApiAdapter.init()` is in the `adapters` array of `@App`
- [ ] Adapter has a unique `name` for tool namespacing
- [ ] `specUrl` points to a valid, reachable OpenAPI JSON/YAML endpoint (or `spec` is inline)

### Runtime

- [ ] Generated tools appear in `tools/list` with `<name>:<operationId>` naming
- [ ] Auth headers are sent correctly on API calls
- [ ] Spec polling refreshes tool definitions at the configured interval
- [ ] Invalid spec URL produces a clear startup error

### Production

- [ ] API tokens and secrets are loaded from environment variables
- [ ] Polling interval is appropriate for the API's update frequency
- [ ] Multiple adapter registrations use distinct names

## Troubleshooting

| Problem                            | Cause                                                  | Solution                                                                                |
| ---------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| No tools generated from spec       | Spec URL returns non-OpenAPI content or is unreachable | Verify URL returns valid OpenAPI 3.x JSON; check network access                         |
| Authentication errors on API calls | Wrong auth type or missing credentials                 | Match `auth.type` to the API's security scheme; verify env vars are set                 |
| Duplicate tool name error          | Two adapters registered with the same `name`           | Give each adapter a unique `name` (e.g., `'github'`, `'jira'`)                          |
| Stale tools after API update       | Spec polling not configured                            | Add `polling: { intervalMs: 300000 }` to refresh every 5 minutes                        |
| TypeScript error importing adapter | Wrong import path                                      | Import from `@frontmcp/adapters`: `import { OpenApiAdapter } from '@frontmcp/adapters'` |

## Reference

- [Adapter Overview Documentation](https://docs.agentfront.dev/frontmcp/adapters/overview)
- Related skills: `create-adapter`, `create-plugin`, `create-tool`
