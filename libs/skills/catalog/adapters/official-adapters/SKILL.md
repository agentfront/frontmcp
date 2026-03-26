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

## Reference

- Adapter docs: [docs.agentfront.dev/frontmcp/adapters/overview](https://docs.agentfront.dev/frontmcp/adapters/overview)
- OpenAPI adapter: [`@frontmcp/adapters`](https://docs.agentfront.dev/frontmcp/adapters/openapi-adapter)
- Spec polling: [docs.agentfront.dev/frontmcp/adapters/openapi-polling](https://docs.agentfront.dev/frontmcp/adapters/openapi-polling)
