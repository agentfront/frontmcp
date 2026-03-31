---
name: nx-workspace-with-apps
reference: project-structure-nx
level: basic
description: 'Scaffold an Nx monorepo with two apps and a server that composes them into a single gateway.'
tags: [setup, nx, structure, workspace, apps]
features:
  - '`apps/` directory holding self-contained `@App` classes with their tools and resources'
  - '`servers/` directory holding `@FrontMcp` entry points that compose apps'
  - 'Nx path aliases (`@my-workspace/billing`) for clean imports across the monorepo'
  - 'Apps are independently testable and do not import from each other'
---

# Nx Workspace with Multiple Apps

Scaffold an Nx monorepo with two apps and a server that composes them into a single gateway.

## Code

```bash
# Scaffold the Nx workspace
npx frontmcp create my-workspace --nx

cd my-workspace

# Generate two apps
nx g @frontmcp/nx:app billing
nx g @frontmcp/nx:app crm

# Generate a server composing both apps
nx g @frontmcp/nx:server gateway --apps=billing,crm
```

```typescript
// apps/billing/src/billing.app.ts
import { App } from '@frontmcp/sdk';
import { CreateInvoiceTool } from './tools/create-invoice.tool';
import { InvoiceResource } from './resources/invoice.resource';

@App({
  name: 'billing',
  tools: [CreateInvoiceTool],
  resources: [InvoiceResource],
})
export class BillingApp {}
```

```typescript
// apps/crm/src/crm.app.ts
import { App } from '@frontmcp/sdk';
import { LookupUserTool } from './tools/lookup-user.tool';

@App({
  name: 'crm',
  tools: [LookupUserTool],
})
export class CrmApp {}
```

```typescript
// servers/gateway/src/main.ts
import 'reflect-metadata';
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

## What This Demonstrates

- `apps/` directory holding self-contained `@App` classes with their tools and resources
- `servers/` directory holding `@FrontMcp` entry points that compose apps
- Nx path aliases (`@my-workspace/billing`) for clean imports across the monorepo
- Apps are independently testable and do not import from each other

## Related

- See `project-structure-nx` for the full directory layout, dependency rules, and generator reference
