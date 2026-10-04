---
name: local-apps-with-shared-tools
reference: multi-app-composition
level: basic
description: 'Compose multiple local `@App` classes into a server with shared tools available to all apps.'
tags: [setup, multi-app, local, multi, app, composition]
features:
  - 'Multiple `@App` classes with unique `id` fields, which prefix their tools when two tools share a name (`billing:charge`)'
  - 'Server-level `tools` array for shared tools every app serves under their own name (`server:<name>` when an app tool has the same name)'
  - 'Each app is self-contained with its own tools array'
  - 'The `id` field on `@App` is the prefix of its tools when names collide'
---

# Local Apps with Shared Tools

Compose multiple local `@App` classes into a server with shared tools available to all apps.

## Code

```typescript
// src/apps/billing.app.ts
import { App } from '@frontmcp/sdk';

import { ChargeTool } from '../tools/charge.tool';
import { RefundTool } from '../tools/refund.tool';

@App({
  id: 'billing',
  name: 'Billing',
  tools: [ChargeTool, RefundTool],
})
export class BillingApp {}
```

```typescript
// src/apps/inventory.app.ts
import { App } from '@frontmcp/sdk';

import { CheckStockTool } from '../tools/check-stock.tool';

@App({
  id: 'inventory',
  name: 'Inventory',
  tools: [CheckStockTool],
})
export class InventoryApp {}
```

```typescript
// src/tools/health-check.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';

@Tool({
  name: 'health_check',
  description: 'Check server health',
})
export default class HealthCheckTool extends ToolContext {
  async execute() {
    return { content: [{ type: 'text', text: 'OK' }] };
  }
}
```

```typescript
// src/main.ts
import 'reflect-metadata';

import { FrontMcp } from '@frontmcp/sdk';

import { BillingApp } from './apps/billing.app';
import { InventoryApp } from './apps/inventory.app';
import HealthCheckTool from './tools/health-check.tool';

@FrontMcp({
  info: { name: 'gateway', version: '1.0.0' },
  apps: [BillingApp, InventoryApp],
  tools: [HealthCheckTool],
})
export default class Server {}
```

## What This Demonstrates

- Multiple `@App` classes with unique `id` fields, which prefix their tools when two tools share a name (`billing:charge`)
- Server-level `tools` array for shared tools every app serves under their own name (`server:<name>` when an app tool has the same name)
- Each app is self-contained with its own tools array
- The `id` field on `@App` is the prefix of its tools when names collide

## Related

- See `multi-app-composition` for ESM apps, remote apps, scope isolation, and per-app auth
