---
name: scaffold-and-generate
reference: nx-workflow
level: basic
description: 'Initialize an Nx workspace and use generators to scaffold an app with tools, resources, and a server.'
tags: [setup, nx, workflow, scaffold, generate]
features:
  - '`@frontmcp/nx:workspace` initializes the Nx monorepo structure with `apps/`, `libs/`, `servers/`'
  - 'All primitive generators require `--project=<app-name>` to target the correct app'
  - 'Each generator creates an implementation file, a `.spec.ts` test file, and updates barrel exports'
  - '`@frontmcp/nx:server` with `--apps` and `--deploymentTarget` creates the deployment entry point'
---

# Scaffold Workspace and Generate Primitives

Initialize an Nx workspace and use generators to scaffold an app with tools, resources, and a server.

## Code

```bash
# Option A: New workspace via FrontMCP CLI
npx frontmcp create my-project --nx

# Option B: Add FrontMCP to existing Nx workspace
yarn add -D @frontmcp/nx
nx g @frontmcp/nx:workspace my-workspace
```

```bash
# Generate an app
nx g @frontmcp/nx:app billing

# Generate primitives inside the app
nx g @frontmcp/nx:tool create-invoice --project=billing
nx g @frontmcp/nx:resource invoice --project=billing
nx g @frontmcp/nx:prompt billing-summary --project=billing
nx g @frontmcp/nx:provider stripe --project=billing
nx g @frontmcp/nx:plugin audit-log --project=billing

# Generate a shared library
nx g @frontmcp/nx:lib shared-utils

# Generate a server composing the app
nx g @frontmcp/nx:server gateway --apps=billing --deploymentTarget=node
```

```bash
# Verify the generated structure
nx test billing
nx build gateway
```

## What This Demonstrates

- `@frontmcp/nx:workspace` initializes the Nx monorepo structure with `apps/`, `libs/`, `servers/`
- All primitive generators require `--project=<app-name>` to target the correct app
- Each generator creates an implementation file, a `.spec.ts` test file, and updates barrel exports
- `@frontmcp/nx:server` with `--apps` and `--deploymentTarget` creates the deployment entry point

## Related

- See `nx-workflow` for the complete generator reference table and CI workflow commands
