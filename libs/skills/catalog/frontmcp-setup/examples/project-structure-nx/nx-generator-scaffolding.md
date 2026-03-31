---
name: nx-generator-scaffolding
reference: project-structure-nx
level: basic
description: 'Use `@frontmcp/nx` generators to scaffold tools, resources, and providers within an app, with automatic barrel export updates.'
tags: [setup, nx, structure, generator, scaffolding]
features:
  - 'All primitive generators require `--project=<app-name>` to target the correct app'
  - 'Each generator creates the implementation file and a `.spec.ts` test file'
  - 'Barrel exports (`index.ts`) are updated automatically after each generator run'
  - 'Files follow the `<name>.<type>.ts` naming convention'
---

# Nx Generator Scaffolding

Use `@frontmcp/nx` generators to scaffold tools, resources, and providers within an app, with automatic barrel export updates.

## Code

```bash
# Generate a tool in the billing app
nx g @frontmcp/nx:tool create-invoice --project=billing

# Generate a resource in the billing app
nx g @frontmcp/nx:resource invoice --project=billing

# Generate a provider in the billing app
nx g @frontmcp/nx:provider stripe --project=billing

# Generate a prompt in the crm app
nx g @frontmcp/nx:prompt summarize --project=crm

# Generate a plugin in the crm app
nx g @frontmcp/nx:plugin logging --project=crm
```

After generation, the app directory looks like:

```text
apps/billing/
  src/
    tools/
      create-invoice.tool.ts
      create-invoice.tool.spec.ts
    resources/
      invoice.resource.ts
      invoice.resource.spec.ts
    providers/
      stripe.provider.ts
      stripe.provider.spec.ts
    billing.app.ts
    index.ts          # barrel exports updated automatically
  project.json
  tsconfig.json
  jest.config.ts
```

```bash
# Build and test the app
nx test billing
nx build gateway
```

## What This Demonstrates

- All primitive generators require `--project=<app-name>` to target the correct app
- Each generator creates the implementation file and a `.spec.ts` test file
- Barrel exports (`index.ts`) are updated automatically after each generator run
- Files follow the `<name>.<type>.ts` naming convention

## Related

- See `project-structure-nx` for the complete generator reference and workspace structure
