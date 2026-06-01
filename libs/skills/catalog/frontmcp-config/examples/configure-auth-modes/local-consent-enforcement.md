---
name: local-consent-enforcement
reference: configure-auth-modes
level: intermediate
description: 'Enable consent in local mode to enforce a per-token authorized-tools claim, keeping essential tools always available via excludedTools.'
tags: [config, auth, local, consent, tool-authorization, auth-modes]
features:
  - 'Setting `consent.enabled` so the issued token carries an authorized-tools claim enforced at call time'
  - 'Listing `excludedTools` so essential tools are always available and never gated by consent'
  - 'Understanding that no interactive tool-selection page is rendered today (the claim defaults to all available tools)'
---

# Local Consent Enforcement

Enable consent in local mode to enforce a per-token authorized-tools claim, keeping essential tools always available via excludedTools.

## Code

```typescript
// src/server.ts
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'health',
  description: 'Health check',
  inputSchema: {},
  outputSchema: { ok: z.boolean() },
})
class HealthTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@Tool({
  name: 'delete_account',
  description: 'Delete a user account',
  inputSchema: { userId: z.string() },
  outputSchema: { deleted: z.boolean() },
})
class DeleteAccountTool extends ToolContext {
  async execute(input: { userId: string }) {
    return { deleted: true };
  }
}

@App({
  name: 'admin-api',
  auth: {
    mode: 'local',
    consent: {
      enabled: true,
      // `health` is always callable and never gated by the authorized-tools claim.
      excludedTools: ['health'],
    },
  },
  tools: [HealthTool, DeleteAccountTool],
})
class AdminApi {}

@FrontMcp({
  info: { name: 'consent-server', version: '1.0.0' },
  apps: [AdminApi],
})
class Server {}
```

## What This Demonstrates

- Setting `consent.enabled` so the issued token carries an authorized-tools claim enforced at call time
- Listing `excludedTools` so essential tools are always available and never gated by consent
- Understanding that no interactive tool-selection page is rendered today (the claim defaults to all available tools)

## Related

- See `configure-auth-modes` for a comparison of all auth modes
- See `local-self-signed-tokens` for persisting tokens across restarts
