---
name: multi-server-deployment
reference: nx-workflow
level: advanced
description: 'Generate multiple servers in an Nx workspace, each composing different apps for different deployment targets.'
tags: [setup, vercel, nx, node, workflow, multi]
features:
  - 'Multiple servers composing different combinations of apps from the same workspace'
  - 'Each server has its own deployment target (`node` vs `vercel`) and storage configuration'
  - 'Apps are reusable across servers via Nx path aliases'
  - '`nx build <server>` builds the server and all its app and lib dependencies'
---

# Multi-Server Deployment Targets

Generate multiple servers in an Nx workspace, each composing different apps for different deployment targets.

## Code

```bash
# Generate apps
nx g @frontmcp/nx:app billing
nx g @frontmcp/nx:app crm
nx g @frontmcp/nx:app admin

# Generate a public gateway (Node.js) composing billing and crm
nx g @frontmcp/nx:server public-gateway --apps=billing,crm --deploymentTarget=node --redis=docker

# Generate an internal admin server (Vercel) with the admin app
nx g @frontmcp/nx:server admin-portal --apps=admin --deploymentTarget=vercel

# Generate a shared library for common providers
nx g @frontmcp/nx:lib shared-db
```

```typescript
// servers/public-gateway/src/main.ts
import 'reflect-metadata';
import { FrontMcp } from '@frontmcp/sdk';
import { BillingApp } from '@my-workspace/billing';
import { CrmApp } from '@my-workspace/crm';

@FrontMcp({
  info: { name: 'public-gateway', version: '1.0.0' },
  apps: [BillingApp, CrmApp],
  http: { port: 3000 },
  redis: {
    provider: 'redis',
    host: process.env['REDIS_HOST'] ?? 'localhost',
    port: parseInt(process.env['REDIS_PORT'] ?? '6379', 10),
  },
})
class PublicGateway {}

export default PublicGateway;
```

```typescript
// servers/admin-portal/src/main.ts
import 'reflect-metadata';
import { FrontMcp } from '@frontmcp/sdk';
import { AdminApp } from '@my-workspace/admin';

@FrontMcp({
  info: { name: 'admin-portal', version: '1.0.0' },
  apps: [AdminApp],
  transport: { protocol: 'modern' },
  redis: { provider: 'vercel-kv' },
})
class AdminPortal {}

export default AdminPortal;
```

```bash
# Build each server independently
nx build public-gateway
nx build admin-portal

# Test all projects
nx run-many -t test
```

## What This Demonstrates

- Multiple servers composing different combinations of apps from the same workspace
- Each server has its own deployment target (`node` vs `vercel`) and storage configuration
- Apps are reusable across servers via Nx path aliases
- `nx build <server>` builds the server and all its app and lib dependencies

## Related

- See `nx-workflow` for the full generator reference and workspace setup options
