---
name: stateless-api-serverless
reference: configure-transport-protocol-presets
level: intermediate
description: 'Use the stateless-api preset for Vercel, Lambda, or Cloudflare Workers.'
tags: [config, vercel, lambda, cloudflare, session, transport]
features:
  - "The `'stateless-api'` preset disables SSE, streaming, and sessions entirely"
  - 'Each request is standalone with no server-side state'
  - "Pair with `sessionMode: 'stateless'` for serverless execution"
  - 'Required for Vercel, Lambda, Cloudflare Workers where persistent connections are not allowed'
---

# Stateless API Preset for Serverless

Use the stateless-api preset for Vercel, Lambda, or Cloudflare Workers.

## Code

```typescript
// src/server.ts
import { FrontMcp, App, Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'translate',
  description: 'Translate text between languages',
  inputSchema: {
    text: z.string(),
    targetLang: z.string(),
  },
  outputSchema: { translated: z.string() },
})
class TranslateTool extends ToolContext {
  async execute(input: { text: string; targetLang: string }) {
    return { translated: `[${input.targetLang}] ${input.text}` };
  }
}

@App({
  name: 'translate-api',
  tools: [TranslateTool],
})
class TranslateApp {}

@FrontMcp({
  info: { name: 'serverless-translate', version: '1.0.0' },
  apps: [TranslateApp],
  transport: {
    sessionMode: 'stateless',
    protocol: 'stateless-api',
  },
})
class Server {}
// Enables: Stateless HTTP only
// Flags: { sse: false, streamable: false, json: false, stateless: true, legacy: false, strictSession: false }
```

## What This Demonstrates

- The `'stateless-api'` preset disables SSE, streaming, and sessions entirely
- Each request is standalone with no server-side state
- Pair with `sessionMode: 'stateless'` for serverless execution
- Required for Vercel, Lambda, Cloudflare Workers where persistent connections are not allowed

## Related

- See `configure-transport-protocol-presets` for all preset definitions
- See `configure-transport` for full transport configuration
