---
name: project-structure-nx
description: Best practices for organizing a FrontMCP Nx monorepo -- apps, libs, servers, generators, and multi-app composition. Use when working with frontmcp create --nx or an Nx workspace.
tags: [project, structure, nx, monorepo, organization, best-practices]
priority: 8
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/nx-plugin/overview
---

# Nx Monorepo Project Structure

When you scaffold with `frontmcp create --nx` or add FrontMCP to an existing Nx workspace, the recommended layout separates apps, shared libraries, and server entry points:

```
my-workspace/
├── apps/                     # @App classes (one app per directory)
│   ├── billing/
│   │   ├── src/
│   │   │   ├── billing.app.ts
│   │   │   ├── tools/
│   │   │   ├── resources/
│   │   │   └── providers/
│   │   ├── project.json
│   │   └── tsconfig.json
│   └── crm/
│       ├── src/
│       │   ├── crm.app.ts
│       │   ├── tools/
│       │   └── resources/
│       ├── project.json
│       └── tsconfig.json
├── libs/                     # Shared libraries
│   └── shared-utils/
│       ├── src/
│       │   └── index.ts
│       ├── project.json
│       └── tsconfig.json
├── servers/                  # @FrontMcp servers composing apps
│   └── gateway/
│       ├── src/
│       │   └── main.ts       # @FrontMcp default export
│       ├── project.json
│       └── tsconfig.json
├── nx.json
├── tsconfig.base.json
├── CLAUDE.md                 # AI config (auto-generated)
├── AGENTS.md
├── .mcp.json
└── .cursorrules
```

## Directory Roles

### apps/ -- Application Modules

Each directory under `apps/` contains a single `@App` class with its tools, resources, prompts, providers, and plugins:

```typescript
// apps/billing/src/billing.app.ts
import { App } from '@frontmcp/sdk';
import { CreateInvoiceTool } from './tools/create-invoice.tool';
import { InvoiceResource } from './resources/invoice.resource';
import { StripeProvider } from './providers/stripe.provider';

@App({
  name: 'billing',
  tools: [CreateInvoiceTool],
  resources: [InvoiceResource],
  providers: [StripeProvider],
})
export class BillingApp {}
```

Apps are self-contained and independently testable. They do not import from other apps -- shared code goes in `libs/`.

### libs/ -- Shared Libraries

Shared providers, utilities, types, and common logic live under `libs/`:

```typescript
// libs/shared-utils/src/index.ts
export { formatCurrency } from './format-currency';
export { DatabaseProvider } from './database.provider';
export type { AppConfig } from './app-config.interface';
```

Apps and servers import from libs using Nx path aliases configured in `tsconfig.base.json`:

```typescript
import { DatabaseProvider } from '@my-workspace/shared-utils';
```

### servers/ -- FrontMcp Entry Points

A server composes multiple apps into a single `@FrontMcp` entry point:

```typescript
// servers/gateway/src/main.ts
import { FrontMcp } from '@frontmcp/sdk';
import { BillingApp } from '@my-workspace/billing';
import { CrmApp } from '@my-workspace/crm';

@FrontMcp({
  info: { name: 'gateway', version: '1.0.0' },
  apps: [BillingApp, CrmApp],
})
class GatewayServer {}

export default GatewayServer;
```

You can have multiple servers composing different combinations of apps (e.g., a public-facing server and an internal admin server).

## Nx Generators

The `@frontmcp/nx-plugin` package provides generators for all entity types:

```bash
# Generate a new app
nx g @frontmcp/nx-plugin:app crm

# Generate entities within an app
nx g @frontmcp/nx-plugin:tool lookup-user --project=crm
nx g @frontmcp/nx-plugin:resource user-profile --project=crm
nx g @frontmcp/nx-plugin:prompt summarize --project=crm
nx g @frontmcp/nx-plugin:provider database --project=crm
nx g @frontmcp/nx-plugin:plugin logging --project=crm
nx g @frontmcp/nx-plugin:agent research --project=crm
nx g @frontmcp/nx-plugin:job cleanup --project=crm

# Generate a new server
nx g @frontmcp/nx-plugin:server gateway

# Generate a shared library
nx g @frontmcp/nx-plugin:lib shared-utils
```

## Build and Test Commands

```bash
# Build a specific server
nx build gateway

# Test a specific app
nx test billing

# Run all tests
nx run-many -t test

# Build all projects
nx run-many -t build

# Lint everything
nx run-many -t lint
```

Nx caches build and test results. Subsequent runs for unchanged projects are instant.

## AI Configuration Files

FrontMCP auto-generates AI configuration files at the workspace root:

| File           | Purpose                                  |
| -------------- | ---------------------------------------- |
| `CLAUDE.md`    | Instructions for Claude Code / Claude AI |
| `AGENTS.md`    | Instructions for agent-based AI tools    |
| `.mcp.json`    | MCP server configuration for AI IDEs     |
| `.cursorrules` | Rules for Cursor AI editor               |

These files are regenerated when you run generators or modify your workspace structure. They help AI tools understand your project layout and coding conventions.

## Dependency Graph

Nx enforces a clear dependency hierarchy:

```
servers/ --> apps/ --> libs/
```

- **servers** can import from **apps** and **libs**
- **apps** can import from **libs** only (never from other apps or servers)
- **libs** can import from other **libs** only

Use `nx graph` to visualize the dependency graph and ensure no circular imports exist.
