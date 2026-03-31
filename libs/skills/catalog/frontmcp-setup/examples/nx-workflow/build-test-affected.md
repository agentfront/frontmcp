---
name: build-test-affected
reference: nx-workflow
level: intermediate
description: 'Use Nx commands for efficient building, testing, and CI with affected-only execution.'
tags: [setup, nx, workflow, affected]
features:
  - '`nx build <server>` resolves the dependency graph and builds with caching'
  - '`nx affected -t test` only runs tests for changed projects, saving CI time'
  - '`nx run-many -t build,test,lint` parallelizes multiple targets across all projects'
  - '`nx graph` visualizes project dependencies to detect circular imports'
---

# Build, Test, and Affected Commands

Use Nx commands for efficient building, testing, and CI with affected-only execution.

## Code

```bash
# Build a single server (builds all dependencies in correct order)
nx build gateway

# Test a single app
nx test billing

# Run all tests across the workspace
nx run-many -t test

# Build all projects
nx run-many -t build

# Lint everything
nx run-many -t lint

# Run multiple targets at once
nx run-many -t build,test,lint
```

```bash
# CI optimization: only test projects affected by changes
nx affected -t test

# Only build affected projects
nx affected -t build

# Visualize the dependency graph
nx graph
```

```bash
# Typical feature development workflow
# 1. Generate a new tool
nx g @frontmcp/nx:tool calculate-tax --project=billing

# 2. Implement the tool logic in apps/billing/src/tools/calculate-tax.tool.ts

# 3. Run tests for the affected app
nx test billing

# 4. Build the server that includes this app
nx build gateway

# 5. Or test everything affected by your changes
nx affected -t test
```

## What This Demonstrates

- `nx build <server>` resolves the dependency graph and builds with caching
- `nx affected -t test` only runs tests for changed projects, saving CI time
- `nx run-many -t build,test,lint` parallelizes multiple targets across all projects
- `nx graph` visualizes project dependencies to detect circular imports

## Related

- See `nx-workflow` for workspace initialization, all generator commands, and troubleshooting
