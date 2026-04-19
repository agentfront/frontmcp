---
name: multi-app-with-plugins-and-providers
reference: decorators-guide
level: intermediate
description: 'Demonstrates a server with multiple `@App` modules, a `@Provider` for dependency injection, and a `@Plugin` for cross-cutting concerns.'
tags: [development, database, multi-app, decorators, multi, app]
features:
  - 'Organizing a server into multiple `@App` modules (`analytics` and `admin`)'
  - 'Using `@Provider` with `useFactory` to register a database client for dependency injection'
  - 'Accessing injected dependencies via `this.get(DatabaseToken)` in tools and resources'
  - 'Using `@ResourceTemplate` with URI parameters (`{dashboardId}`) for dynamic resources'
  - 'Registering a `@Plugin` at the server level so it applies across all apps'
  - 'Global plugins go in `@FrontMcp({ plugins })`, app-scoped providers go in `@App({ providers })`'
---

# Multi-App Server with Plugins and Providers

Demonstrates a server with multiple `@App` modules, a `@Provider` for dependency injection, and a `@Plugin` for cross-cutting concerns.

## Code

```typescript
// src/providers/database.provider.ts
import { Provider } from '@frontmcp/sdk';

export const DatabaseToken = Symbol('Database');

@Provider({
  name: 'database',
  provide: DatabaseToken,
  useFactory: () => new DatabaseClient(process.env.DB_URL),
})
class DatabaseProvider {}
```

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
    const db = this.get(DatabaseToken);
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
    const db = this.get(DatabaseToken);
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
class DashboardResource extends ResourceContext {
  async read(uri: string, params: { dashboardId: string }) {
    const db = this.get(DatabaseToken);
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
  providers: [DatabaseProvider],
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
- Using `@Provider` with `useFactory` to register a database client for dependency injection
- Accessing injected dependencies via `this.get(DatabaseToken)` in tools and resources
- Using `@ResourceTemplate` with URI parameters (`{dashboardId}`) for dynamic resources
- Registering a `@Plugin` at the server level so it applies across all apps
- Global plugins go in `@FrontMcp({ plugins })`, app-scoped providers go in `@App({ providers })`

## Related

- See `decorators-guide` for the complete list of all decorator fields and their types
- See `create-plugin-hooks` for adding lifecycle hooks to plugins
