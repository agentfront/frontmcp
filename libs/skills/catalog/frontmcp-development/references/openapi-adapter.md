---
name: openapi-adapter
description: Convert OpenAPI 3.x specifications into MCP tools with authentication, polling, transforms, format resolution, and $ref security
---

# OpenAPI Adapter

The OpenAPI adapter converts OpenAPI 3.x specifications into MCP tools — one tool per operation. It supports authentication, spec polling, operation filtering, input/output/tool transforms, format resolution, and built-in SSRF protection.

## When to Use This Skill

### Must Use

- Converting an OpenAPI/Swagger 3.x specification into MCP tools automatically
- Integrating a REST API that provides a public OpenAPI spec (Petstore, GitHub, Jira, Slack)
- Setting up authentication (API key, bearer token, OAuth) for adapter-generated tools

### Recommended

- Enriching tool schemas with format resolution (uuid, date-time, email, etc.)
- Filtering which API operations become tools
- Hiding sensitive inputs and injecting server-side values via input transforms
- Enabling spec polling to auto-refresh tools when the upstream API changes

### Skip When

- The external API has no OpenAPI spec (see `create-adapter` for custom adapters)
- You need to build tools manually with custom logic (see `create-tool`)
- You only need adapters overview and comparison (see `official-adapters`)

> **Decision:** Use this skill when you have an OpenAPI 3.x spec and want comprehensive guidance on `OpenapiAdapter` configuration.

## Quick Start

```typescript
import { FrontMcp, App } from '@frontmcp/sdk';
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

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  http: { port: 3000 },
})
class MyServer {}
// Generated tools: petstore:addPet, petstore:getPetById, petstore:deletePet, etc.
```

Each OpenAPI operation becomes a tool named `<adapter-name>:<operationId>`.

## Authentication

Five strategies with different security risk levels:

```typescript
// 1. Static Headers (Medium Risk) — server-to-server APIs
OpenapiAdapter.init({
  name: 'my-api',
  url: 'https://api.example.com/openapi.json',
  baseUrl: 'https://api.example.com',
  additionalHeaders: {
    'x-api-key': process.env.API_KEY!,
  },
});

// 2. Auth Provider Mapper (Low Risk) ⭐ Recommended — multi-provider
OpenapiAdapter.init({
  name: 'multi-auth-api',
  url: 'https://api.example.com/openapi.json',
  baseUrl: 'https://api.example.com',
  authProviderMapper: {
    GitHubAuth: (ctx) => ctx.authInfo.user?.githubToken,
    SlackAuth: (ctx) => ctx.authInfo.user?.slackToken,
  },
});

// 3. Custom Security Resolver (Low Risk) — full control
OpenapiAdapter.init({
  name: 'my-api',
  url: 'https://api.example.com/openapi.json',
  baseUrl: 'https://api.example.com',
  securityResolver: (tool, ctx) => {
    return { jwt: ctx.authInfo?.token };
  },
});

// 4. Static Auth (Medium Risk) — fixed credentials
OpenapiAdapter.init({
  name: 'my-api',
  url: 'https://api.example.com/openapi.json',
  baseUrl: 'https://api.example.com',
  staticAuth: {
    jwt: process.env.API_TOKEN!,
  },
});

// 5. Dynamic Headers & Body Mapping (Low Risk) — context injection
OpenapiAdapter.init({
  name: 'my-api',
  url: 'https://api.example.com/openapi.json',
  baseUrl: 'https://api.example.com',
  headersMapper: (ctx, headers) => {
    headers.set('Authorization', `Bearer ${ctx.authInfo?.token}`);
    return headers;
  },
});
```

| Risk Level | Strategy                                   | Description                                          |
| ---------- | ------------------------------------------ | ---------------------------------------------------- |
| LOW        | `authProviderMapper` or `securityResolver` | Auth from user context, not exposed to clients       |
| MEDIUM     | `staticAuth`, `additionalHeaders`          | Static credentials                                   |
| HIGH       | `includeSecurityInInput: true`             | Auth fields exposed to MCP clients (not recommended) |

## Spec Polling

Auto-refresh tool definitions when the upstream API changes:

```typescript
OpenapiAdapter.init({
  name: 'evolving-api',
  url: 'https://api.example.com/openapi.json',
  polling: {
    intervalMs: 300000, // Re-fetch every 5 minutes
  },
});
```

## Inline Spec

Provide the OpenAPI spec directly instead of fetching from URL:

```typescript
OpenapiAdapter.init({
  name: 'my-api',
  spec: {
    openapi: '3.0.0',
    info: { title: 'My API', version: '1.0.0' },
    paths: {
      '/users': {
        get: {
          operationId: 'listUsers',
          summary: 'List all users',
          responses: { '200': { description: 'OK' } },
        },
      },
    },
  },
});
```

## Multiple Adapters

Register adapters from different APIs in the same app:

```typescript
@App({
  name: 'IntegrationHub',
  adapters: [
    OpenapiAdapter.init({ name: 'github', url: 'https://api.github.com/openapi.json' }),
    OpenapiAdapter.init({ name: 'jira', url: 'https://jira.example.com/openapi.json' }),
    OpenapiAdapter.init({ name: 'slack', url: 'https://slack.com/openapi.json' }),
  ],
})
class IntegrationHub {}
// Tools: github:createIssue, jira:createTicket, slack:postMessage, etc.
```

## Filtering Operations

Control which API operations become MCP tools:

```typescript
// Filter by path prefix
OpenapiAdapter.init({
  name: 'billing-api',
  url: 'https://api.example.com/openapi.json',
  generateOptions: {
    filterFn: (op) => op.path.startsWith('/invoices') || op.path.startsWith('/customers'),
  },
});

// Include only specific operations
OpenapiAdapter.init({
  name: 'my-api',
  url: 'https://api.example.com/openapi.json',
  generateOptions: {
    includeOperations: ['getUser', 'createUser', 'updateUser'],
  },
});

// Exclude specific operations
OpenapiAdapter.init({
  name: 'my-api',
  url: 'https://api.example.com/openapi.json',
  generateOptions: {
    excludeOperations: ['deprecatedEndpoint', 'internalOnly'],
  },
});
```

## Input Transforms

Hide inputs from AI/users and inject values server-side:

```typescript
OpenapiAdapter.init({
  name: 'tenant-api',
  url: 'https://api.example.com/openapi.json',
  baseUrl: 'https://api.example.com',
  inputTransforms: {
    global: [
      // Hide tenant header from AI, inject from user context
      { inputKey: 'X-Tenant-Id', inject: (ctx) => ctx.authInfo.user?.tenantId },
      // Add correlation ID to all requests
      { inputKey: 'X-Correlation-Id', inject: () => crypto.randomUUID() },
    ],
    perTool: {
      createAuditLog: [{ inputKey: 'userId', inject: (ctx) => ctx.authInfo.user?.id }],
    },
  },
});
```

## Format Resolution

Enrich generated tool schemas with concrete constraints from OpenAPI `format` values (uuid, date-time, email, int32, etc.):

```typescript
// Enable built-in format resolvers
OpenapiAdapter.init({
  name: 'my-api',
  url: 'https://api.example.com/openapi.json',
  generateOptions: {
    resolveFormats: true,
  },
});

// Add custom format resolvers (merged with built-ins when resolveFormats: true)
OpenapiAdapter.init({
  name: 'my-api',
  url: 'https://api.example.com/openapi.json',
  generateOptions: {
    resolveFormats: true,
    formatResolvers: {
      phone: (schema) => ({
        ...schema,
        pattern: '^\\+[1-9]\\d{1,14}$',
        description: 'E.164 phone number',
      }),
      currency: (schema) => ({
        ...schema,
        pattern: '^[A-Z]{3}$',
        description: 'ISO 4217 currency code',
      }),
    },
  },
});

// Custom resolvers only (no built-ins)
OpenapiAdapter.init({
  name: 'my-api',
  url: 'https://api.example.com/openapi.json',
  generateOptions: {
    formatResolvers: {
      phone: (schema) => ({ ...schema, pattern: '^\\+[1-9]\\d{1,14}$' }),
    },
  },
});
```

| Option            | Type                             | Default     | Description                                                                                  |
| ----------------- | -------------------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| `resolveFormats`  | `boolean`                        | `false`     | Enable built-in format resolvers (uuid, date-time, email, int32, etc.)                       |
| `formatResolvers` | `Record<string, FormatResolver>` | `undefined` | Custom resolvers; merged with built-ins when `resolveFormats: true`, custom takes precedence |

## $ref Resolution Security

By default, the adapter blocks dangerous `$ref` resolution patterns to prevent SSRF attacks:

- `file://` protocol is blocked (prevents local file reads)
- Internal/private IPs are blocked (prevents cloud metadata theft, internal network probing)
- `http://` and `https://` to public hosts are allowed

Configure via `loadOptions.refResolution`:

```typescript
// Restrict $refs to specific hosts only
OpenapiAdapter.init({
  name: 'my-api',
  url: 'https://api.example.com/openapi.json',
  loadOptions: {
    refResolution: {
      allowedHosts: ['schemas.example.com'],
    },
  },
});

// Allow file:// protocol (for specs referencing local schema files)
OpenapiAdapter.init({
  name: 'my-api',
  url: 'https://api.example.com/openapi.json',
  loadOptions: {
    refResolution: {
      allowedProtocols: ['http', 'https', 'file'],
    },
  },
});

// Allow internal IPs (only in trusted environments)
OpenapiAdapter.init({
  name: 'internal-api',
  url: 'http://10.0.0.5:8080/openapi.json',
  loadOptions: {
    refResolution: {
      allowInternalIPs: true,
    },
  },
});

// Block ALL external refs (only resolve local #/ pointers)
OpenapiAdapter.init({
  name: 'my-api',
  url: 'https://api.example.com/openapi.json',
  loadOptions: {
    refResolution: {
      allowedProtocols: [],
    },
  },
});
```

| Option             | Type       | Default             | Description                                                                               |
| ------------------ | ---------- | ------------------- | ----------------------------------------------------------------------------------------- |
| `allowedProtocols` | `string[]` | `['http', 'https']` | Protocols allowed for external `$ref` resolution (http, https, ftp, ws, etc.)             |
| `allowedHosts`     | `string[]` | `undefined`         | When set, only refs to these hostnames are resolved                                       |
| `blockedHosts`     | `string[]` | `undefined`         | Additional hostnames/IPs to block beyond the built-in list                                |
| `allowInternalIPs` | `boolean`  | `false`             | Disable the built-in internal IP block list (127.x, 10.x, 172.16.x, 169.254.x, localhost) |

## Load Options

Configure how the OpenAPI spec is loaded:

```typescript
OpenapiAdapter.init({
  name: 'my-api',
  url: 'https://api.example.com/openapi.json',
  baseUrl: 'https://api.example.com',
  loadOptions: {
    headers: { authorization: `Bearer ${process.env.SPEC_ACCESS_TOKEN}` },
    timeout: 10000,
    validate: true,
    dereference: true,
  },
});
```

## Common Patterns

| Pattern              | Correct                                                    | Incorrect                                           | Why                                             |
| -------------------- | ---------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------- |
| Adapter registration | `OpenapiAdapter.init({ ... })` in `adapters` array         | Placing adapter in `plugins` array                  | Adapters go in `adapters`, not `plugins`        |
| Tool naming          | Tools auto-named as `<name>:<operationId>`                 | Expecting flat names like `listPets`                | Adapter name prevents collisions                |
| Auth configuration   | `staticAuth: { jwt: process.env.API_TOKEN! }`              | Hardcoding secrets: `staticAuth: { jwt: 'sk-xxx' }` | Always use environment variables                |
| Spec source          | Use `url` for hosted specs or `spec` for inline            | Using both `url` and `spec` simultaneously          | Only one source; `spec` takes precedence        |
| Multiple APIs        | Separate `OpenapiAdapter.init()` with unique `name` values | Same `name` for different adapters                  | Duplicate names cause tool collisions           |
| $ref security        | Use default `refResolution` (blocks file://, internal IPs) | Setting `allowInternalIPs: true` in production      | Default protects against SSRF                   |
| Format resolution    | `generateOptions: { resolveFormats: true }`                | Writing manual patterns for standard formats        | Built-in resolvers handle uuid, date-time, etc. |

## Verification Checklist

### Configuration

- [ ] `@frontmcp/adapters` package is installed
- [ ] `OpenapiAdapter.init()` is in the `adapters` array of `@App`
- [ ] Adapter has a unique `name` for tool namespacing
- [ ] `url` points to a valid, reachable OpenAPI JSON/YAML endpoint (or `spec` is inline)

### Runtime

- [ ] Generated tools appear in `tools/list` with `<name>:<operationId>` naming
- [ ] Auth headers are sent correctly on API calls
- [ ] Spec polling refreshes tool definitions at the configured interval
- [ ] Invalid spec URL produces a clear startup error

### Production

- [ ] API tokens and secrets are loaded from environment variables
- [ ] Polling interval is appropriate for the API's update frequency
- [ ] Multiple adapter registrations use distinct names
- [ ] $ref resolution defaults are appropriate (or explicitly configured)

## Troubleshooting

| Problem                            | Cause                                                  | Solution                                                                                                  |
| ---------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| No tools generated from spec       | Spec URL returns non-OpenAPI content or is unreachable | Verify URL returns valid OpenAPI 3.x JSON; check network access                                           |
| Authentication errors on API calls | Wrong auth config or missing credentials               | Configure `staticAuth`, `securityResolver`, `authProviderMapper`, or `additionalHeaders`; verify env vars |
| Duplicate tool name error          | Two adapters with the same `name`                      | Give each adapter a unique `name`                                                                         |
| Stale tools after API update       | Spec polling not configured                            | Add `polling: { intervalMs: 300000 }`                                                                     |
| External $refs not resolving       | Default SSRF protection blocks external refs           | Add `loadOptions.refResolution.allowedHosts` or `allowedProtocols`                                        |
| SSRF warning / $ref to internal IP | Spec contains $refs to internal services               | Blocked by default; use `refResolution.allowInternalIPs: true` only in trusted environments               |
| TypeScript error importing adapter | Wrong import path                                      | Import from `@frontmcp/adapters`                                                                          |

## Examples

| Example                                                                                                           | Level        | Description                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`basic-openapi-adapter`](../examples/openapi-adapter/basic-openapi-adapter.md)                                   | Basic        | Demonstrates converting an OpenAPI specification into MCP tools automatically using `OpenapiAdapter` with minimal configuration.                              |
| [`authenticated-adapter-with-polling`](../examples/openapi-adapter/authenticated-adapter-with-polling.md)         | Intermediate | Demonstrates configuring authentication (API key and bearer token) and automatic spec polling for OpenAPI adapters.                                           |
| [`format-resolution-and-custom-resolvers`](../examples/openapi-adapter/format-resolution-and-custom-resolvers.md) | Intermediate | Demonstrates using built-in and custom format resolvers to enrich tool input schemas with concrete constraints from OpenAPI format values.                    |
| [`ref-security-and-filtering`](../examples/openapi-adapter/ref-security-and-filtering.md)                         | Intermediate | Demonstrates configuring $ref resolution security to prevent SSRF attacks and filtering which API operations become MCP tools.                                |
| [`multi-api-hub-with-inline-spec`](../examples/openapi-adapter/multi-api-hub-with-inline-spec.md)                 | Advanced     | Demonstrates registering multiple OpenAPI adapters from different APIs in a single app, including one with an inline spec definition instead of a remote URL. |

> See all examples in [`examples/openapi-adapter/`](../examples/openapi-adapter/)

## Reference

- [OpenAPI Adapter Documentation](https://docs.agentfront.dev/frontmcp/adapters/openapi-adapter)
- Related skills: `official-adapters`, `create-adapter`, `create-tool`
