---
name: multi-app-with-plugins-and-providers
reference: decorators-guide
level: intermediate
description: 'Demonstrates a server with multiple `@App` modules, a `@Provider` for dependency injection, and a `@Plugin` for cross-cutting concerns.'
tags: [development, database, multi-app, decorators, multi, app]
features:
  - 'Organizing a server into multiple `@App` modules (`analytics` and `admin`)'
  - 'Decorating a service class with `@Provider` so it acts as its own DI token'
  - 'Accessing injected dependencies via `this.get(DatabaseClient)` in tools and resources'
  - 'Using `@ResourceTemplate` with URI parameters (`{dashboardId}`) for dynamic resources'
  - 'Registering a `@Plugin` at the server level so it applies across all apps'
  - 'Global plugins go in `@FrontMcp({ plugins })`, app-scoped providers go in `@App({ providers })`'
---

# Multi-App Server with Plugins and Providers

Demonstrates a server with multiple `@App` modules, a `@Provider` for dependency injection, and a `@Plugin` for cross-cutting concerns.

## Code

```typescript
// src/providers/database.provider.ts
import { Provider, ProviderScope } from '@frontmcp/sdk';

// The @Provider decorator schema is strict: it accepts only `id|name|description|scope`.
// `provide`/`useClass`/`useValue`/`useFactory` are NOT supported.
// For simple cases, decorate the class itself — it becomes its own DI token.
@Provider({
  name: 'DatabaseClient',
  scope: ProviderScope.GLOBAL,
})
export class DatabaseClient {
  constructor(private readonly url = process.env.DB_URL) {}

  async query(sql: string): Promise<unknown[]> {
    /* ... */
    return [];
  }

  async getDataset(id: string): Promise<unknown[]> {
    /* ... */
    return [];
  }

  async getDashboard(id: string): Promise<unknown> {
    /* ... */
    return {};
  }
}
```

> If you need an async factory or want to bind to a separate token, use the
> `AsyncProvider({ provide, name, scope, inject, useFactory })` helper instead of
> the `@Provider` decorator.

```typescript
// src/plugins/audit.plugin.ts
import { Plugin } from '@frontmcp/sdk';

@Plugin({
  name: 'audit-log',
  providers: [AuditLogProvider],
  contextExtensions: [installAuditExtension],
})
class AuditPlugin {}
```

```typescript
// src/tools/query.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'run_query',
  description: 'Run an analytics query',
  inputSchema: {
    sql: z.string().describe('SQL query to execute'),
  },
})
class QueryTool extends ToolContext {
  async execute(input: { sql: string }) {
    const db = this.get(DatabaseClient);
    const results = await db.query(input.sql);
    return { rows: results };
  }
}
```

```typescript
// src/tools/report.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'generate_report',
  description: 'Generate a formatted report from a dataset',
  inputSchema: {
    datasetId: z.string(),
    format: z.enum(['csv', 'json', 'pdf']),
  },
})
class ReportTool extends ToolContext {
  async execute(input: { datasetId: string; format: string }) {
    const db = this.get(DatabaseClient);
    const data = await db.getDataset(input.datasetId);
    return { report: `Report in ${input.format} format`, rows: data.length };
  }
}
```

```typescript
// src/resources/dashboard.resource.ts
import { ResourceContext, ResourceTemplate } from '@frontmcp/sdk';

@ResourceTemplate({
  name: 'dashboard',
  uriTemplate: 'dashboards://{dashboardId}',
  description: 'Dashboard data by ID',
  mimeType: 'application/json',
})
class DashboardResource extends ResourceContext<{ dashboardId: string }> {
  async execute(uri: string, params: { dashboardId: string }) {
    const db = this.get(DatabaseClient);
    const data = await db.getDashboard(params.dashboardId);
    return { contents: [{ uri, text: JSON.stringify(data) }] };
  }
}
```

```typescript
// src/server.ts
import { App, FrontMcp } from '@frontmcp/sdk';

@App({
  name: 'analytics',
  tools: [QueryTool, ReportTool],
  resources: [DashboardResource],
  providers: [DatabaseClient],
})
class AnalyticsApp {}

@App({
  name: 'admin',
  tools: [ManageUsersTool],
})
class AdminApp {}

@FrontMcp({
  info: { name: 'multi-app-server', version: '1.0.0' },
  apps: [AnalyticsApp, AdminApp],
  plugins: [AuditPlugin],
  http: { port: 3000 },
})
class MyServer {}
```

## What This Demonstrates

- Organizing a server into multiple `@App` modules (`analytics` and `admin`)
- Decorating a service class with `@Provider({ name, scope })` so it acts as its own DI token (the strict schema rejects `useFactory`/`useClass`/`provide` — use `AsyncProvider` for those)
- Accessing injected dependencies via `this.get(DatabaseClient)` in tools and resources
- Using `@ResourceTemplate` with URI parameters (`{dashboardId}`) for dynamic resources
- Registering a `@Plugin` at the server level so it applies across all apps
- Global plugins go in `@FrontMcp({ plugins })`, app-scoped providers go in `@App({ providers })`

## Related

- See `decorators-guide` for the complete list of all decorator fields and their types
- See `create-plugin-hooks` for adding lifecycle hooks to plugins
