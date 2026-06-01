---
name: local-consent-enforcement
reference: configure-auth-modes
level: intermediate
description: 'Enable consent in local mode to render a tool-selection screen at login and enforce the chosen tools at call time, keeping essential tools always available via excludedTools.'
tags: [config, auth, local, consent, tool-authorization, auth-modes]
features:
  - 'Setting `consent.enabled` so login renders a tool-selection screen and the chosen tools are enforced on every tools/call'
  - 'Listing `excludedTools` so essential tools are never offered and are always available'
  - 'Honoring `requireSelection` / `defaultSelectedTools` to require a non-empty selection and pre-check tools'
  - 'Pinning `rememberConsent: false` to re-show the screen on every login (the default `true` reuses a prior per-(user, client) selection and only re-prompts when a NEW tool appears)'
---

# Local Consent Enforcement

Enable consent in local mode to render a tool-selection screen at login and enforce the chosen tools at call time, keeping essential tools always available via excludedTools.

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
      requireSelection: true, // reject an empty submit (default)
      // Re-show the screen on every login so the user must explicitly opt into
      // delete_account each time. `rememberConsent` defaults to `true` (reuse a
      // prior per-(user, client) selection); pin it `false` for an opt-in-every-time
      // screen like this one.
      rememberConsent: false,
      // `health` is never offered on the consent screen and is always callable.
      excludedTools: ['health'],
      // Pre-check nothing dangerous: the user must explicitly opt into delete_account.
      defaultSelectedTools: [],
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

- Setting `consent.enabled` so login renders a tool-selection screen and the chosen tools are enforced on every tools/call
- Listing `excludedTools` so essential tools are never offered and are always available
- Honoring `requireSelection` / `defaultSelectedTools` to require a non-empty selection and pre-check tools
- Pinning `rememberConsent: false` to re-show the screen on every login (the default `true` reuses a prior per-(user, client) selection and only re-prompts when a NEW tool appears)

## Related

- See `configure-auth-modes` for a comparison of all auth modes
- See `local-self-signed-tokens` for persisting tokens across restarts
