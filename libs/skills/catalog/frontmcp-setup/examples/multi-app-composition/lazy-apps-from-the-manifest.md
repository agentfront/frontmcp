---
name: lazy-apps-from-the-manifest
reference: multi-app-composition
level: intermediate
description: 'Import apps on their first call, listed from `frontmcp.manifest.json` until then.'
tags: [setup, multi-app, lazy, manifest, build, startup]
features:
  - '`{ name, lazy: () => import(...) }` in `apps` imports the app on its first call, once for concurrent calls'
  - '`frontmcp build` writes `frontmcp.manifest.json`, which lists the app until then; the server reads it next to its entry'
  - "The lazy app's `enabled` refuses its entries with `FEATURE_OFF` while it is off, and keeps it unimported once the manifest lists it"
  - 'Without a manifest, development imports lazy apps at startup (an app whose `enabled` source is off too; only `enabled: false` is skipped) and production refuses to start'
---

# Lazy Apps from the Build Manifest

Import apps on their first call, listed from `frontmcp.manifest.json` until then.

## Code

```typescript
// src/billing.app.ts
import { z } from 'zod';

import { App, Tool, ToolContext } from '@frontmcp/sdk';

@Tool({
  name: 'charge',
  description: 'Charge a customer',
  inputSchema: { customer: z.string(), cents: z.number().int() },
  outputSchema: { receipt: z.string() },
})
class ChargeTool extends ToolContext {
  async execute(input: { customer: string; cents: number }) {
    return { receipt: `R-${input.customer}` };
  }
}

@App({ id: 'billing', name: 'Billing', tools: [ChargeTool] })
export class BillingApp {}
```

```typescript
// src/main.ts
import 'reflect-metadata';

import { fileSignal, FrontMcp } from '@frontmcp/sdk';

import { CoreApp } from './core.app';

@FrontMcp({
  info: { name: 'gateway', version: '1.0.0' },
  apps: [
    CoreApp,
    { id: 'billing', name: 'Billing', lazy: () => import('./billing.app') },
    {
      id: 'reports',
      name: 'Reports',
      lazy: () => import('./reports.app'),
      enabled: fileSignal('./features.json', 'reports'),
    },
  ],
})
export default class Server {}
```

```bash
frontmcp build --target node        # writes dist/node/gateway.bundle.js and dist/node/frontmcp.manifest.json next to it
NODE_ENV=production node dist/node/gateway.bundle.js   # `gateway`: the name in frontmcp.config or package.json
```

## What This Demonstrates

- `{ name, lazy: () => import(...) }` in `apps` imports the app on its first call, once for concurrent calls
- `frontmcp build` writes `frontmcp.manifest.json`, which lists the app until then; the server reads it next to its entry
- The lazy app's `enabled` refuses its entries with `FEATURE_OFF` while it is off, and keeps it unimported once the manifest lists it
- Without a manifest, development imports lazy apps at startup (an app whose `enabled` source is off too; only `enabled: false` is skipped) and production refuses to start

## Related

- See `multi-app-composition` for what a lazy app cannot have and how a stale manifest is handled
- See `frontmcp-deployment` → `build-manifest` for what the manifest holds
