---
name: inject-instructions
reference: configure-skills-http
level: basic
description: Set a server-level instructions string and append the skill catalog summary on every initialize response.
tags: [config, skills, instructions, injection, initialize]
features:
  - 'Top-level `instructions` on `@FrontMcp` exposes a global system prompt to MCP clients'
  - "`skillsConfig.injectInstructions: 'append'` adds the skill catalog summary after the user prompt"
  - 'Dynamic skills are picked up because the composer runs on every initialize request'
  - 'Catalog summary is bounded at 16 KB with a truncation footer pointing at skill://catalog'
---

# Inject Instructions on Initialize

Set a server-level instructions string and append the skill catalog summary on every initialize response.

## Code

```typescript
// src/server.ts
import { FrontMcp } from '@frontmcp/sdk';

import { MainApp } from './main.app';

@FrontMcp({
  info: { name: 'flight-bot', version: '1.0.0' },
  apps: [MainApp],

  // Server-level instructions surfaced to MCP clients
  instructions: [
    'You are a helpful assistant for booking flights.',
    'Always confirm dates with the user before issuing a booking.',
  ].join('\n'),

  skillsConfig: {
    enabled: true,
    mcpResources: true,
    // 'append' (default) — the skill catalog summary is appended after instructions
    // 'prepend' — summary first, then instructions
    // 'replace' — summary only (skills drive the entire system prompt)
    // 'off'    — instructions sent as-is, no summary
    injectInstructions: 'append',
  },
})
export default class FlightBotServer {}
```

## What This Demonstrates

- Top-level `instructions` on `@FrontMcp` exposes a global system prompt to MCP clients
- `skillsConfig.injectInstructions: 'append'` adds the skill catalog summary after the user prompt
- Dynamic skills are picked up because the composer runs on every initialize request
- Catalog summary is bounded at 16 KB with a truncation footer pointing at skill://catalog

## Related

- See `configure-skills-http` for the full `skillsConfig` reference
- See `decorators-guide` for the `@FrontMcp` decorator's complete option table
