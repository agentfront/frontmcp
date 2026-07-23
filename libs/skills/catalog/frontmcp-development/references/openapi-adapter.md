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
import { OpenapiAdapter } from '@frontmcp/adapters';
import { App, FrontMcp } from '@frontmcp/sdk';

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
    enabled: true,
    intervalMs: 300000, // Re-fetch every 5 minutes
  },
});
```

> **SSRF (GHSA-65h7-9wrw-629c):** the poll re-fetches the same attacker-influenceable
> spec `url` on a timer, so it runs through the **same SSRF guard** as the initial load —
> it inherits `loadOptions.refResolution` (validates the resolved IP, pins the connection,
> re-validates redirects). Loopback/private/internal spec servers are blocked by default;
> a blocked poll fails closed (no fetch, no update) and is logged. To poll an internal or
> localhost spec, set `loadOptions.refResolution.allowInternalIPs: true` — trusted/local only.

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

## Spec Loading & $ref Resolution Security (SSRF)

> **Advisories: GHSA-v6ph-xcq9-qxxj, GHSA-65h7-9wrw-629c.** Loading a spec fetches
> attacker-influenceable URLs (the spec `url` and any external `$ref`s) — an SSRF
> vector. Hostname-string denylists are bypassable via DNS names that resolve to
> internal IPs (e.g. `http://127.0.0.1.nip.io/`), redirects, and IPv4-mapped IPv6.
> **Use `mcp-from-openapi` ≥ 2.5.0**, which resolves DNS and validates the
> _resolved IP_, guards the spec-URL fetch (not just `$ref`s), and re-validates
> every redirect hop.

FrontMCP's secure defaults:

- **External `$ref` resolution is disabled by default** — only internal `#/...`
  refs resolve; inline `spec:` is unaffected. Enable by setting
  `loadOptions.refResolution` explicitly.
- **Spec-URL redirects are not followed by default** — opt in with
  `loadOptions.followRedirects: true` (each hop is still re-validated).
- **Internal/private targets are blocked** for the spec `url` and `$ref`s alike
  (loopback, RFC 1918, CGNAT, link-local/cloud-metadata `169.254/16`, multicast,
  IPv6 ULA/link-local), and hostnames are **DNS-resolved** and re-checked.
- **`file://` is blocked** (prevents local file reads).

Configure via `loadOptions.refResolution` (applies to the spec URL **and** `$ref`s):

```typescript
// DEFAULT: external $refs disabled, redirects not followed, internal targets blocked.
// (No config needed; shown for clarity.)
OpenapiAdapter.init({
  name: 'my-api',
  url: 'https://api.example.com/openapi.json',
  loadOptions: {
    refResolution: { allowedProtocols: [] },
  },
});

// Enable external $refs (public hosts only; internal targets stay blocked, DNS-validated)
OpenapiAdapter.init({
  name: 'my-api',
  url: 'https://api.example.com/openapi.json',
  loadOptions: {
    refResolution: { allowedProtocols: ['http', 'https'] },
  },
});

// Restrict the spec URL / $refs to specific hosts only
OpenapiAdapter.init({
  name: 'my-api',
  url: 'https://api.example.com/openapi.json',
  loadOptions: {
    refResolution: { allowedProtocols: ['http', 'https'], allowedHosts: ['schemas.example.com'] },
  },
});

// Local / internal development: allow loopback/private targets for the spec URL AND $refs
OpenapiAdapter.init({
  name: 'local-api',
  url: 'http://localhost:3000/openapi.json',
  loadOptions: {
    refResolution: { allowInternalIPs: true },
  },
});
```

These apply to **both** the spec-URL fetch and external `$ref` resolution (`mcp-from-openapi` ≥ 2.5.0):

| Option             | Type       | Default (FrontMCP) | Description                                                                                                                           |
| ------------------ | ---------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `allowedProtocols` | `string[]` | `[]`               | Protocols allowed for external `$ref` resolution. **FrontMCP defaults to `[]`** (external refs off); set `['http','https']` to enable |
| `allowedHosts`     | `string[]` | `undefined`        | When set, only the spec URL / `$ref` URLs to these hostnames are allowed                                                              |
| `blockedHosts`     | `string[]` | `undefined`        | Additional hostnames/IPs to block beyond the built-in internal-address list                                                           |
| `allowInternalIPs` | `boolean`  | `false`            | Allow loopback/private/internal targets for the spec URL **and** `$ref`s (skips ranges + DNS recheck). Trusted/local only             |

> `followRedirects` (a `loadOptions` field, not `refResolution`) defaults to `false` in FrontMCP.

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

| Pattern              | Correct                                                                                                         | Incorrect                                                                                                           | Why                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Adapter registration | `OpenapiAdapter.init({ ... })` in `adapters` array                                                              | Placing adapter in `plugins` array                                                                                  | Adapters go in `adapters`, not `plugins`                                                                |
| Tool naming          | Tools auto-named as `<name>:<operationId>`                                                                      | Expecting flat names like `listPets`                                                                                | Adapter name prevents collisions                                                                        |
| Auth configuration   | `staticAuth: { jwt: process.env.API_TOKEN! }`                                                                   | Hardcoding secrets: `staticAuth: { jwt: 'sk-xxx' }`                                                                 | Always use environment variables                                                                        |
| Spec source          | Use `url` for hosted specs or `spec` for inline                                                                 | Using both `url` and `spec` simultaneously                                                                          | Only one source; `spec` takes precedence                                                                |
| Multiple APIs        | Separate `OpenapiAdapter.init()` with unique `name` values                                                      | Same `name` for different adapters                                                                                  | Duplicate names cause tool collisions                                                                   |
| Spec/$ref SSRF       | Keep secure defaults (external refs off, redirects off, internal targets blocked) on `mcp-from-openapi` ≥ 2.5.0 | Setting `allowInternalIPs: true` in production; forwarding untrusted spec URLs without an `allowedHosts` allow-list | Defaults protect against SSRF (incl. DNS-name-to-internal); the spec **poller inherits the same guard** |
| Format resolution    | `generateOptions: { resolveFormats: true }`                                                                     | Writing manual patterns for standard formats                                                                        | Built-in resolvers handle uuid, date-time, etc.                                                         |

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

| Problem                                                      | Cause                                                                    | Solution                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| No tools generated from spec                                 | Spec URL returns non-OpenAPI content or is unreachable                   | Verify URL returns valid OpenAPI 3.x JSON; check network access                                           |
| Authentication errors on API calls                           | Wrong auth config or missing credentials                                 | Configure `staticAuth`, `securityResolver`, `authProviderMapper`, or `additionalHeaders`; verify env vars |
| Duplicate tool name error                                    | Two adapters with the same `name`                                        | Give each adapter a unique `name`                                                                         |
| Stale tools after API update                                 | Spec polling not configured                                              | Add `polling: { intervalMs: 300000 }`                                                                     |
| External $refs not resolving                                 | External refs are **disabled by default** in FrontMCP                    | Set `loadOptions.refResolution.allowedProtocols: ['http','https']` (add `allowedHosts` to restrict)       |
| Spec URL / $ref to internal host blocked                     | Target is loopback/private, or a DNS name resolving to one (SSRF guard)  | Use `refResolution.allowInternalIPs: true` only in trusted/local environments                             |
| Polling never updates from an internal/localhost spec server | The poll re-fetch is SSRF-guarded and blocks internal targets by default | Set `loadOptions.refResolution.allowInternalIPs: true` (trusted/local only)                               |
| Spec URL redirect not followed                               | `followRedirects` defaults to `false`                                    | Set `loadOptions.followRedirects: true` (each hop is re-validated on `mcp-from-openapi` ≥ 2.5.0)          |
| TypeScript error importing adapter                           | Wrong import path                                                        | Import from `@frontmcp/adapters`                                                                          |

## Examples

| Example                                                                                                           | Level        | Description                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`basic-openapi-adapter`](../examples/openapi-adapter/basic-openapi-adapter.md)                                   | Basic        | Demonstrates converting an OpenAPI specification into MCP tools automatically using `OpenapiAdapter` with minimal configuration.                                |
| [`authenticated-adapter-with-polling`](../examples/openapi-adapter/authenticated-adapter-with-polling.md)         | Intermediate | Demonstrates configuring authentication (API key and bearer token) and automatic spec polling for OpenAPI adapters.                                             |
| [`format-resolution-and-custom-resolvers`](../examples/openapi-adapter/format-resolution-and-custom-resolvers.md) | Intermediate | Demonstrates using built-in and custom format resolvers to enrich tool input schemas with concrete constraints from OpenAPI format values.                      |
| [`ref-security-and-filtering`](../examples/openapi-adapter/ref-security-and-filtering.md)                         | Intermediate | Demonstrates configuring $ref / spec-URL resolution security to prevent SSRF attacks (GHSA-65h7-9wrw-629c) and filtering which API operations become MCP tools. |
| [`multi-api-hub-with-inline-spec`](../examples/openapi-adapter/multi-api-hub-with-inline-spec.md)                 | Advanced     | Demonstrates registering multiple OpenAPI adapters from different APIs in a single app, including one with an inline spec definition instead of a remote URL.   |

> See all examples in [`examples/openapi-adapter/`](../examples/openapi-adapter/)

## Reference

- [OpenAPI Adapter Documentation](https://docs.agentfront.dev/frontmcp/adapters/openapi-adapter)
- Related skills: `official-adapters`, `create-adapter`, `create-tool`
