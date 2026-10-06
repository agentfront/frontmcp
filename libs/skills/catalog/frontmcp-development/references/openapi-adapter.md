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

Each OpenAPI operation becomes a tool named `<adapter-name>:<operationId>`. A call is checked against the
operation's schema before any request goes out: a value outside an `enum` or a missing required field fails with
`Invalid arguments for tool '<name>': <field>: <problem>` (up to 1.9.1 such arguments were sent as given).

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
  securityResolver: async (tool, ctx) => {
    // A credential issued for the API, never the caller's own ctx.authInfo.token
    return { jwt: await getApiToken(ctx) };
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
    const tenantId = ctx.authInfo.user?.tenantId;
    if (tenantId) headers.set('x-tenant-id', tenantId);
    return headers;
  },
});

// Opt-in token passthrough (High Risk) — only when the API accepts tokens issued for this MCP server
OpenapiAdapter.init({
  name: 'same-issuer-api',
  url: 'https://api.example.com/openapi.json',
  baseUrl: 'https://api.example.com',
  passthroughCallerToken: true,
});
```

With no `authProviderMapper`, `securityResolver` or `staticAuth`, the adapter sends **no** credentials: operations that require auth fail with `Authentication required for tool '…'` and a `SECURITY WARNING` is logged at startup. The caller's MCP token (`ctx.authInfo.token`) is never forwarded implicitly — not by default, and not when an `authProviderMapper` function returns `undefined` — because passing it to another API is token passthrough, which the MCP specification forbids. `passthroughCallerToken: true` is the explicit opt-in, used only after every other credential source came up empty.

| Risk Level | Strategy                                                                            | Description                                          |
| ---------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------- |
| LOW        | `authProviderMapper` or `securityResolver`                                          | Auth from user context, not exposed to clients       |
| MEDIUM     | `staticAuth`, `additionalHeaders`, or none                                          | Static credentials, or no credentials at all         |
| HIGH       | `includeSecurityInInput` (`true` or a list of schemes), or `securitySchemesInInput` | Auth fields exposed to MCP clients (not recommended) |
| HIGH       | `passthroughCallerToken: true`                                                      | The MCP client's own token is sent to the API        |

`passthroughCallerToken: true` scores HIGH alongside an `authProviderMapper` too (the token is sent when no mapper function returns a credential); only a `securityResolver` or a non-empty `staticAuth` leaves it unused.

Resolution order: `securityResolver` → `authProviderMapper` → `staticAuth` (fills every credential no mapper function returned; a mapped value wins) → `passthroughCallerToken`. A security scheme with no `authProviderMapper` entry is refused at startup unless `staticAuth` covers it, `additionalHeaders` carries its credential, `headersMapper` may set it (a header or cookie scheme, checked on each request), or `passthroughCallerToken` does for an HTTP bearer scheme (it sends the caller's token for it and logs a `SECURITY WARNING`; the caller's token never fills an API key, basic, OAuth2 or OpenID Connect scheme). An operation that requires auth is sent only with a credential for one of its own schemes, from a credential option, the tool input (`securitySchemesInInput`, or `includeSecurityInInput`: `true` for every scheme, a list for the schemes it names, like `securitySchemesInInput`; the schemes a list leaves out still need a credential source), `additionalHeaders` or `headersMapper`; otherwise it fails with `Authentication required for tool '…'`. A tool-input credential is used for a scheme only when no other source supplies one (a server credential always wins).

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

## Options From Providers (`useFactory`)

Build the options at startup from injected providers. The factory returns `OpenApiAdapterOptions` (or a promise of them); the adapter is built from them under the `name` given to `init()`:

```typescript
OpenapiAdapter.init({
  name: 'billing',
  inject: () => [BillingConfig] as const,
  useFactory: (config: BillingConfig) => ({ name: 'billing', url: config.specUrl, baseUrl: config.baseUrl }),
});
```

Until 1.8.7 this form failed startup with `Cannot read properties of undefined (reading 'name')` plus an unhandled rejection that could end the Node process.

## Filtering Operations

Control which API operations become MCP tools. Every `generateOptions` field is passed to `mcp-from-openapi`'s generator, and an operation becomes a tool only when it passes every filter you set:

```typescript
// Filter by OpenAPI tag
OpenapiAdapter.init({
  name: 'billing-api',
  url: 'https://api.example.com/openapi.json',
  generateOptions: {
    includeTags: ['invoices', 'customers'], // carries one of these tags
    excludeTags: ['internal'], // carries none of these
  },
});

// Filter by path glob (`*` = within a segment, `**` = across segments, `?` = one character)
OpenapiAdapter.init({
  name: 'billing-api',
  url: 'https://api.example.com/openapi.json',
  generateOptions: {
    includePaths: ['/invoices/**', '/customers/*'],
    excludePaths: ['/invoices/*/admin/**'],
  },
});

// Read-only tools only (annotations say readOnlyHint: true — GET/HEAD/OPTIONS/TRACE unless overridden)
OpenapiAdapter.init({
  name: 'billing-api',
  url: 'https://api.example.com/openapi.json',
  generateOptions: { readOnlyOnly: true },
});

// Filter by HTTP method (any case; a name that is not an HTTP method stops the adapter)
OpenapiAdapter.init({
  name: 'billing-api',
  url: 'https://api.example.com/openapi.json',
  generateOptions: { excludeMethods: ['delete', 'put'] }, // or includeMethods: ['get']
});

// Custom filter (runs after every other filter)
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
    includeOperations: ['getUser', 'createUser', 'updateUser'], // operations without an operationId are left out
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

The adapter's own defaults are `preferredStatusCodes: [200, 201, 202, 204]`, `includeDeprecated: false` and `includeAllResponses: true`; every other generator option (`maxToolNameLength`, `descriptionStrategy`, `target`, …) takes the value you set.

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

### Tool-execution redirects (a separate phase)

The rules above cover _loading the spec_. **Calling** a generated tool is a different fetch,
and it never follows redirects either (**GHSA-qh67-4345-cw2q**): the adapter sets
`redirect: 'manual'` and refuses any 3xx -- and the status-0 `opaqueredirect` response browser
runtimes return instead -- with `OPENAPI_REDIRECT_NOT_FOLLOWED`.

Following one would send the request to a destination the _upstream_ chose. Only `baseUrl` is
validated, and only for its scheme, so a 3xx is an unvalidated hop -- including to an internal
or cloud-metadata address. `fetch` also strips only `Authorization` and `Cookie` across
origins and **forwards custom headers**, which is exactly how this adapter injects API keys
(`security.headers`, `additionalHeaders`), so following would disclose the backend credential
to the redirect target.

If an operation legitimately redirects, point `baseUrl` at the final host instead.

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
    overlays: curationOverlay, // OpenAPI Overlay 1.0 document(s), applied before validation
    secureDefaults: true, // no redirects, no external $refs (FrontMCP's defaults already are)
  },
});
```

Every `mcp-from-openapi` load option reaches the loader; up to 1.9.1 `overlays` and `secureDefaults` were dropped.

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
