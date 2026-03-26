---
name: multi-app-composition
description: Compose multiple apps in a single server with shared tools, scoped auth, and external app loading. Use when building multi-app servers, sharing tools between apps, loading ESM or remote apps, or configuring per-app auth.
tags: [multi-app, composition, architecture, scope, shared-tools]
priority: 9
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/features/multi-app-composition
---

# Multi-App Composition

Compose multiple `@App` classes into a single `@FrontMcp` server. Each app contributes its own tools, resources, prompts, skills, and plugins. Apps can be local classes, npm packages loaded at runtime, or remote MCP servers proxied through your gateway.

## When to Use Multi-App

**Single app** is sufficient when your server has one logical domain (e.g., a calculator, a file manager). Define one `@App` class with all tools and resources:

```typescript
@App({ name: 'Calculator', tools: [AddTool, SubtractTool] })
class CalcApp {}

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [CalcApp],
})
export default class Server {}
```

**Multi-app** is needed when you have multiple domains, separate auth requirements, external MCP servers to aggregate, or npm packages to compose at runtime. The `apps` array in `@FrontMcp` accepts any combination of local classes, ESM packages, and remote servers.

## Local Apps

A local app is a TypeScript class decorated with `@App`. It declares tools, resources, prompts, skills, plugins, providers, agents, jobs, and workflows inline.

The `@App` decorator accepts `LocalAppMetadata`:

```typescript
import { App } from '@frontmcp/sdk';

@App({
  id: 'billing', // string (optional) - unique identifier
  name: 'Billing', // string (required) - display name
  description: 'Payment tools', // string (optional)
  tools: [ChargeCardTool, RefundTool],
  resources: [InvoiceResource],
  prompts: [BillingSummaryPrompt],
  skills: [BillingWorkflowSkill],
  plugins: [AuditLogPlugin], // scoped to this app only
  providers: [StripeProvider],
  agents: [BillingAgent],
  jobs: [ReconcileJob],
  workflows: [MonthlyBillingWorkflow],
  auth: { mode: 'remote', idpProviderUrl: 'https://auth.billing.com' },
  standalone: false, // default - included in multi-app server
})
export class BillingApp {}
```

Register it in the server:

```typescript
@FrontMcp({
  info: { name: 'gateway', version: '1.0.0' },
  apps: [BillingApp, InventoryApp, SupportApp],
})
export default class Server {}
```

## ESM Apps (npm Packages)

Load an `@App`-decorated class from an npm package at runtime using `app.esm()`. The package is fetched, cached, and its default export is treated as a local app.

```typescript
import { FrontMcp, app } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'gateway', version: '1.0.0' },
  apps: [app.esm('@acme/tools@^1.0.0', { namespace: 'acme' }), app.esm('@org/analytics@latest')],
})
export default class Server {}
```

`app.esm(specifier, options?)` accepts a package specifier (e.g., `'@acme/tools@^1.0.0'`) and optional `EsmAppOptions`:

| Option        | Type                                        | Description                                        |
| ------------- | ------------------------------------------- | -------------------------------------------------- |
| `name`        | `string`                                    | Override the auto-derived app name                 |
| `namespace`   | `string`                                    | Namespace prefix for tools, resources, and prompts |
| `description` | `string`                                    | Human-readable description                         |
| `standalone`  | `boolean \| 'includeInParent'`              | Scope isolation mode (default: `false`)            |
| `loader`      | `PackageLoader`                             | Custom registry/bundle URLs and auth token         |
| `autoUpdate`  | `{ enabled: boolean; intervalMs?: number }` | Background version polling                         |
| `importMap`   | `Record<string, string>`                    | Import map overrides for ESM resolution            |
| `filter`      | `AppFilterConfig`                           | Include/exclude filter for primitives              |

Example with custom loader and auto-update:

```typescript
app.esm('@internal/tools@^2.0.0', {
  namespace: 'internal',
  loader: {
    url: 'https://npm.internal.corp',
    token: process.env['NPM_TOKEN'],
  },
  autoUpdate: { enabled: true, intervalMs: 300_000 },
});
```

## Remote Apps (External MCP Servers)

Proxy tools, resources, and prompts from an external MCP server using `app.remote()`. The gateway connects via Streamable HTTP (with SSE fallback) and exposes the remote primitives as if they were local.

```typescript
import { FrontMcp, app } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'gateway', version: '1.0.0' },
  apps: [
    app.remote('https://api.example.com/mcp', { namespace: 'api' }),
    app.remote('https://slack-mcp.internal/mcp', {
      namespace: 'slack',
      remoteAuth: {
        mode: 'static',
        credentials: { type: 'bearer', value: process.env['SLACK_TOKEN']! },
      },
    }),
  ],
})
export default class Server {}
```

`app.remote(url, options?)` accepts a URL and optional `RemoteUrlAppOptions`:

| Option             | Type                           | Description                                               |
| ------------------ | ------------------------------ | --------------------------------------------------------- |
| `name`             | `string`                       | Override the auto-derived app name (defaults to hostname) |
| `namespace`        | `string`                       | Namespace prefix for tools, resources, and prompts        |
| `description`      | `string`                       | Human-readable description                                |
| `standalone`       | `boolean \| 'includeInParent'` | Scope isolation mode (default: `false`)                   |
| `transportOptions` | `RemoteTransportOptions`       | Timeout, retries, headers, SSE fallback                   |
| `remoteAuth`       | `RemoteAuthConfig`             | Auth config: `'static'`, `'forward'`, or `'oauth'`        |
| `refreshInterval`  | `number`                       | Interval (ms) to refresh capabilities from remote         |
| `cacheTTL`         | `number`                       | TTL (ms) for cached capabilities (default: 60000)         |
| `filter`           | `AppFilterConfig`              | Include/exclude filter for primitives                     |

`RemoteTransportOptions` fields:

| Field           | Type                     | Default | Description                              |
| --------------- | ------------------------ | ------- | ---------------------------------------- |
| `timeout`       | `number`                 | `30000` | Request timeout in ms                    |
| `retryAttempts` | `number`                 | `3`     | Retry attempts for failed requests       |
| `retryDelayMs`  | `number`                 | `1000`  | Delay between retries in ms              |
| `fallbackToSSE` | `boolean`                | `true`  | Fallback to SSE if Streamable HTTP fails |
| `headers`       | `Record<string, string>` | -       | Additional headers for all requests      |

`RemoteAuthConfig` modes:

- `{ mode: 'static', credentials: { type: 'bearer' | 'basic' | 'apiKey', value: string } }` -- static credentials for trusted internal services
- `{ mode: 'forward', tokenClaim?: string, headerName?: string }` -- forward the gateway user's token to the remote server
- `{ mode: 'oauth' }` -- let the remote server handle its own OAuth flow

## Scope Isolation

Each `@App` gets its own Scope. The `standalone` property on `LocalAppMetadata` (and on ESM/remote options) controls how that scope relates to the parent server:

```typescript
// standalone: false (default)
// App is included in the multi-app server. Its tools are merged
// into the unified tool list and namespaced by app id.
@App({ name: 'Billing', standalone: false, tools: [ChargeTool] })
class BillingApp {}

// standalone: true
// App runs as a completely separate scope. It is NOT visible
// in the parent server's tool/resource lists. Useful for apps
// that need total isolation (separate auth, separate session).
@App({ name: 'Admin', standalone: true, tools: [ResetTool] })
class AdminApp {}

// standalone: 'includeInParent'
// App gets its own separate scope but its tools ARE visible
// in the parent server under the app name prefix. Best of both worlds:
// isolation with visibility.
@App({ name: 'Analytics', standalone: 'includeInParent', tools: [QueryTool] })
class AnalyticsApp {}
```

The type is: `standalone?: 'includeInParent' | boolean` (defaults to `false`).

## Tool Namespacing

When multiple apps are composed, tools are automatically namespaced by app id to prevent naming collisions. The format is `appId:toolName`.

```typescript
@App({ id: 'billing', name: 'Billing', tools: [ChargeTool] })
class BillingApp {}
// Tool is exposed as: billing:charge_card

@App({ id: 'inventory', name: 'Inventory', tools: [CheckStockTool] })
class InventoryApp {}
// Tool is exposed as: inventory:check_stock
```

For remote and ESM apps, the `namespace` option controls the prefix:

```typescript
app.remote('https://api.example.com/mcp', { namespace: 'api' });
// Remote tools are exposed as: api:tool_name

app.esm('@acme/tools@^1.0.0', { namespace: 'acme' });
// ESM tools are exposed as: acme:tool_name
```

## Shared Tools

Tools declared directly on `@FrontMcp` (not inside an `@App`) are shared across all apps. They are merged additively with app-specific tools and are available without a namespace prefix.

```typescript
@FrontMcp({
  info: { name: 'gateway', version: '1.0.0' },
  apps: [BillingApp, InventoryApp],
  tools: [HealthCheckTool, WhoAmITool], // shared tools - available to all apps
})
export default class Server {}
```

The same pattern works for shared resources and shared skills:

```typescript
@FrontMcp({
  info: { name: 'gateway', version: '1.0.0' },
  apps: [BillingApp],
  tools: [HealthCheckTool], // shared tools
  resources: [ConfigResource], // shared resources
  skills: [OnboardingSkill], // shared skills
})
export default class Server {}
```

## Shared Plugins

Plugins declared on `@FrontMcp` are server-level plugins instantiated per scope. Every app in the server sees these plugins. Use them for cross-cutting concerns like logging, tracing, PII reduction, and policy enforcement.

```typescript
@FrontMcp({
  info: { name: 'gateway', version: '1.0.0' },
  apps: [BillingApp, InventoryApp],
  plugins: [TracingPlugin, PiiRedactionPlugin], // all apps see these
})
export default class Server {}
```

## Per-App Auth

Each `@App` can have its own `auth` configuration, overriding the server-level auth. This allows mixed authentication modes within a single server -- for example, one app public and another requiring OAuth.

```typescript
// Public app - no auth required
@App({
  name: 'Public',
  tools: [EchoTool, HealthTool],
  auth: { mode: 'public' },
})
class PublicApp {}

// Protected app - requires OAuth
@App({
  name: 'Admin',
  tools: [UserManagementTool, AuditLogTool],
  auth: {
    mode: 'remote',
    idpProviderUrl: 'https://auth.example.com',
    idpExpectedAudience: 'admin-api',
  },
})
class AdminApp {}

@FrontMcp({
  info: { name: 'gateway', version: '1.0.0' },
  apps: [PublicApp, AdminApp],
  // Server-level auth acts as the default for apps without their own auth
  auth: { mode: 'public' },
})
export default class Server {}
```

If an app does not specify `auth`, it inherits the server-level configuration. The `auth` field accepts `AuthOptionsInput`.

## Per-App Plugins

Plugins declared on `@App` are scoped to that app only. They do not affect other apps in the server. Use per-app plugins for app-specific middleware, caching, or domain logic.

```typescript
@App({
  name: 'Billing',
  tools: [ChargeTool],
  plugins: [BillingAuditPlugin, RateLimitPlugin], // only Billing sees these
})
class BillingApp {}

@App({
  name: 'Inventory',
  tools: [CheckStockTool],
  plugins: [InventoryCachePlugin], // only Inventory sees this
})
class InventoryApp {}
```

## Full Composition Example

Combining all patterns into a single server:

```typescript
import 'reflect-metadata';
import { FrontMcp, App, app } from '@frontmcp/sdk';

// Local app with per-app auth and plugins
@App({
  name: 'Billing',
  tools: [ChargeTool, RefundTool],
  plugins: [BillingAuditPlugin],
  auth: { mode: 'remote', idpProviderUrl: 'https://auth.billing.com' },
})
class BillingApp {}

// Local public app
@App({
  name: 'Public',
  tools: [EchoTool],
  auth: { mode: 'public' },
})
class PublicApp {}

// Standalone app with its own isolated scope
@App({
  name: 'Admin',
  tools: [ResetTool],
  standalone: true,
})
class AdminApp {}

@FrontMcp({
  info: { name: 'gateway', version: '1.0.0' },
  apps: [
    BillingApp,
    PublicApp,
    AdminApp,
    app.esm('@acme/crm@^2.0.0', { namespace: 'crm' }),
    app.remote('https://slack-mcp.example.com/mcp', { namespace: 'slack' }),
  ],
  tools: [HealthCheckTool], // shared across all apps
  plugins: [TracingPlugin, PiiPlugin], // shared across all apps
  providers: [DatabaseProvider], // shared across all apps
})
export default class Server {}
```
