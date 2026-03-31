---
name: per-app-auth-and-isolation
reference: multi-app-composition
level: advanced
description: 'Configure mixed authentication modes and scope isolation for different apps in a single server.'
tags: [setup, oauth, auth, multi-app, remote, multi]
features:
  - 'Per-app `auth` overrides the server-level auth (public vs remote OAuth per app)'
  - '`standalone: true` fully isolates the Admin app (not visible in parent tool listing)'
  - "`standalone: 'includeInParent'` gives Analytics its own scope but keeps tools visible"
  - 'Per-app `plugins` (BillingAuditPlugin) are scoped to that app only'
  - 'Server-level `plugins` (TracingPlugin, PiiRedactionPlugin) apply to all apps'
---

# Per-App Auth and Scope Isolation

Configure mixed authentication modes and scope isolation for different apps in a single server.

## Code

```typescript
// src/main.ts
import 'reflect-metadata';
import { FrontMcp, App } from '@frontmcp/sdk';

// Public app - no auth required
@App({
  name: 'Public',
  tools: [EchoTool, HealthTool],
  auth: { mode: 'public' },
})
class PublicApp {}

// Protected app with OAuth
@App({
  id: 'billing',
  name: 'Billing',
  tools: [ChargeTool, RefundTool],
  plugins: [BillingAuditPlugin],
  auth: {
    mode: 'remote',
    idpProviderUrl: 'https://auth.billing.com',
    idpExpectedAudience: 'billing-api',
  },
})
class BillingApp {}

// Fully isolated admin app (standalone: true)
@App({
  name: 'Admin',
  tools: [ResetTool, UserManagementTool],
  standalone: true,
  auth: {
    mode: 'remote',
    idpProviderUrl: 'https://auth.admin.com',
  },
})
class AdminApp {}

// Isolated but visible in parent (standalone: 'includeInParent')
@App({
  id: 'analytics',
  name: 'Analytics',
  tools: [QueryTool],
  standalone: 'includeInParent',
})
class AnalyticsApp {}

@FrontMcp({
  info: { name: 'gateway', version: '1.0.0' },
  apps: [PublicApp, BillingApp, AdminApp, AnalyticsApp],
  plugins: [TracingPlugin, PiiRedactionPlugin],
  auth: { mode: 'public' },
})
export default class Server {}
```

## What This Demonstrates

- Per-app `auth` overrides the server-level auth (public vs remote OAuth per app)
- `standalone: true` fully isolates the Admin app (not visible in parent tool listing)
- `standalone: 'includeInParent'` gives Analytics its own scope but keeps tools visible
- Per-app `plugins` (BillingAuditPlugin) are scoped to that app only
- Server-level `plugins` (TracingPlugin, PiiRedactionPlugin) apply to all apps

## Related

- See `multi-app-composition` for ESM and remote app composition, namespacing, and shared tools
