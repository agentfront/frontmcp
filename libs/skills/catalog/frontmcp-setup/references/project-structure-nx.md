# Nx Monorepo Project Structure

## When to Use This Skill

### Must Use

- Scaffolding a new FrontMCP project with `frontmcp create --nx` or adding FrontMCP to an existing Nx workspace
- Organizing multiple `@App` modules, shared libraries, and `@FrontMcp` server entry points in a monorepo
- Understanding the `apps/`, `libs/`, `servers/` directory hierarchy and Nx dependency rules

### Recommended

- Setting up Nx generators to scaffold tools, resources, providers, and other entities within apps
- Configuring multiple servers that compose different combinations of apps (e.g., public gateway and internal admin)
- Leveraging Nx caching, dependency graph, and `run-many` commands for efficient builds and tests

### Skip When

- You are building a single standalone project without Nx (see `project-structure-standalone`)
- You need to compose multiple apps within a single server and already have the Nx structure (see `multi-app-composition`)
- You are looking for a specific Nx build or CI workflow (see `nx-workflow`)

> **Decision:** Use this skill when setting up or organizing a FrontMCP Nx monorepo and you need the canonical directory layout, generator commands, and dependency rules.

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

## Common Patterns

| Pattern            | Correct                                                          | Incorrect                                                         | Why                                                                            |
| ------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| App isolation      | Apps import from `libs/` only, never from other apps             | `apps/billing` imports from `apps/crm` directly                   | Cross-app imports create circular dependencies; shared code belongs in `libs/` |
| Server composition | `servers/gateway/src/main.ts` imports apps via Nx path aliases   | Server file inlines tool classes instead of importing from apps   | Servers compose `@App` classes; inlining defeats the monorepo separation       |
| Path aliases       | `import { BillingApp } from '@my-workspace/billing'`             | `import { BillingApp } from '../../apps/billing/src/billing.app'` | Nx path aliases in `tsconfig.base.json` keep imports clean and refactorable    |
| Generator usage    | `nx g @frontmcp/nx-plugin:tool lookup-user --project=crm`        | Manually creating tool files without updating barrel exports      | Generators handle file creation, spec scaffolding, and barrel export updates   |
| AI config files    | Let FrontMCP auto-generate `CLAUDE.md`, `AGENTS.md`, `.mcp.json` | Hand-editing auto-generated AI config files                       | These files are regenerated by generators; manual edits will be overwritten    |

## Verification Checklist

### Workspace Structure

- [ ] `nx.json` and `tsconfig.base.json` exist at the workspace root
- [ ] Each app under `apps/` has its own `project.json` and `tsconfig.json`
- [ ] Shared libraries under `libs/` have `project.json` and barrel `index.ts`
- [ ] Server entry points under `servers/` default-export the `@FrontMcp` class

### Build and Test

- [ ] `nx build gateway` (or server name) succeeds without errors
- [ ] `nx test billing` (or app name) passes all tests
- [ ] `nx run-many -t test` runs all tests across the workspace
- [ ] `nx graph` shows no circular dependencies between apps

### Generators

- [ ] `nx g @frontmcp/nx-plugin:app <name>` creates a valid app scaffold
- [ ] `nx g @frontmcp/nx-plugin:tool <name> --project=<app>` creates tool with spec and barrel update
- [ ] `nx g @frontmcp/nx-plugin:server <name>` creates a server entry point

## Troubleshooting

| Problem                                  | Cause                                                   | Solution                                                                   |
| ---------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| Import path not resolving                | Missing or incorrect path alias in `tsconfig.base.json` | Add the correct `@my-workspace/<lib>` path mapping to `tsconfig.base.json` |
| `nx graph` shows circular dependency     | App imports from another app instead of a shared lib    | Move shared code to `libs/` and import from there in both apps             |
| Generator fails with "project not found" | Incorrect `--project` name passed to the generator      | Use the project name from `project.json`, not the directory name           |
| Nx cache returns stale results           | Source files changed but Nx hash did not detect it      | Run `nx reset` to clear the cache, then rebuild                            |
| Server cannot find app export            | App barrel `index.ts` does not export the `@App` class  | Add the app class to the barrel export in `apps/<name>/src/index.ts`       |

## Reference

- [Nx Plugin Documentation](https://docs.agentfront.dev/frontmcp/nx-plugin/overview)
- Related skills: `project-structure-standalone`, `multi-app-composition`, `nx-workflow`, `setup-project`
