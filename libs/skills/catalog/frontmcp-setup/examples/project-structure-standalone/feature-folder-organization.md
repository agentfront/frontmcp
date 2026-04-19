---
name: feature-folder-organization
reference: project-structure-standalone
level: intermediate
description: 'Organize a growing standalone project into domain-specific feature folders instead of flat type-based directories.'
tags: [setup, structure, standalone, feature, folder, organization]
features:
  - 'Feature folders (`src/billing/`) grouping related tools, resources, and providers by domain'
  - 'Each entity still follows the `<name>.<type>.ts` naming convention inside its feature folder'
  - 'One class per file across tools, resources, and providers'
  - 'Feature folders scale better than flat `src/tools/` directories for larger projects'
---

# Feature Folder Organization

Organize a growing standalone project into domain-specific feature folders instead of flat type-based directories.

## Code

```typescript
// src/billing/create-invoice.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'create_invoice',
  description: 'Create a new invoice',
  inputSchema: {
    customerId: z.string(),
    amount: z.number(),
    currency: z.string().default('USD'),
  },
})
export default class CreateInvoiceTool extends ToolContext {
  async execute(input: { customerId: string; amount: number; currency: string }) {
    return {
      content: [{ type: 'text', text: `Invoice created for ${input.customerId}: ${input.currency} ${input.amount}` }],
    };
  }
}
```

```typescript
// src/billing/invoice.resource.ts
import { Resource, ResourceContext } from '@frontmcp/sdk';

@Resource({
  uri: 'invoice://latest',
  name: 'Latest Invoice',
  mimeType: 'application/json',
})
export default class InvoiceResource extends ResourceContext {
  async read() {
    return { contents: [{ uri: 'invoice://latest', text: '{"id":"INV-001","amount":100}' }] };
  }
}
```

```typescript
// src/billing/billing.provider.ts
import { Provider } from '@frontmcp/sdk';

@Provider({ name: 'billing-service' })
export class BillingProvider {
  getBalance(customerId: string): number {
    return 500;
  }
}
```

```typescript
// src/my-app.app.ts
import { App } from '@frontmcp/sdk';

import { BillingProvider } from './billing/billing.provider';
import CreateInvoiceTool from './billing/create-invoice.tool';
import InvoiceResource from './billing/invoice.resource';

@App({
  name: 'my-app',
  tools: [CreateInvoiceTool],
  resources: [InvoiceResource],
  providers: [BillingProvider],
})
export class MyApp {}
```

```typescript
// src/main.ts
import 'reflect-metadata';

import { FrontMcp } from '@frontmcp/sdk';

import { MyApp } from './my-app.app';

@FrontMcp({
  info: { name: 'billing-server', version: '1.0.0' },
  apps: [MyApp],
})
class MyServer {}

export default MyServer;
```

## What This Demonstrates

- Feature folders (`src/billing/`) grouping related tools, resources, and providers by domain
- Each entity still follows the `<name>.<type>.ts` naming convention inside its feature folder
- One class per file across tools, resources, and providers
- Feature folders scale better than flat `src/tools/` directories for larger projects

## Related

- See `project-structure-standalone` for flat layout vs feature folder comparison and naming conventions
