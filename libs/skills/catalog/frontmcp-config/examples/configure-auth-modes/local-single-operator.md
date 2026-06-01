---
name: local-single-operator
reference: configure-auth-modes
level: basic
description: 'Run local mode for a single operator (e.g. Claude Code) by skipping the email prompt and minting a stable anonymous subject.'
tags: [config, auth, local, single-operator, claude-code, auth-modes]
features:
  - 'Setting `requireEmail: false` so the login callback mints a code without prompting for an email'
  - 'Setting `anonymousSubject` so the single operator gets a stable `sub` across logins'
  - 'Persisting tokens with SQLite so the operator stays logged in across restarts'
---

# Single-Operator Local Mode

Run local mode for a single operator (e.g. Claude Code) by skipping the email prompt and minting a stable anonymous subject.

## Code

```typescript
// src/server.ts
// JWT_SECRET still signs the HS256 tokens — set a stable value.
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'list_notes',
  description: 'List the operator notes',
  inputSchema: {},
  outputSchema: { notes: z.array(z.string()) },
})
class ListNotesTool extends ToolContext {
  async execute() {
    return { notes: [] };
  }
}

@App({
  name: 'operator-api',
  auth: {
    mode: 'local',
    // Single operator: do not prompt for an email at /oauth/callback.
    requireEmail: false,
    // Stable subject minted when no email is supplied (this is the default value).
    anonymousSubject: 'local-operator',
    tokenStorage: { sqlite: { path: './data/auth.sqlite' } },
  },
  tools: [ListNotesTool],
})
class OperatorApi {}

@FrontMcp({
  info: { name: 'single-operator-server', version: '1.0.0' },
  apps: [OperatorApi],
})
class Server {}
```

## What This Demonstrates

- Setting `requireEmail: false` so the login callback mints a code without prompting for an email
- Setting `anonymousSubject` so the single operator gets a stable `sub` across logins
- Persisting tokens with SQLite so the operator stays logged in across restarts

## Related

- See `configure-auth-modes` for a comparison of all auth modes
- See `local-minimal` for the smallest local-mode configuration
