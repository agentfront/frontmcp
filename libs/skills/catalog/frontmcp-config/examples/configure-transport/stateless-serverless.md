---
name: stateless-serverless
reference: configure-transport
level: basic
description: 'Configure stateless transport for Vercel, Lambda, or Cloudflare deployments.'
tags: [config, vercel, lambda, cloudflare, session, transport]
features:
  - "Using `sessionMode: 'stateless'` to disable session management"
  - "Using the `'stateless-api'` preset: no SSE, no streaming, pure request/response"
  - 'Each request is standalone with no server-side state between invocations'
  - 'Required for serverless targets (Vercel, Lambda, Cloudflare Workers)'
---

# Stateless Transport for Serverless

Configure stateless transport for Vercel, Lambda, or Cloudflare deployments.

## Code

```typescript
// src/server.ts
import { FrontMcp, App, Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'convert_currency',
  description: 'Convert between currencies',
  inputSchema: {
    amount: z.number(),
    from: z.string(),
    to: z.string(),
  },
  outputSchema: { result: z.number(), rate: z.number() },
})
class ConvertCurrencyTool extends ToolContext {
  async execute(input: { amount: number; from: string; to: string }) {
    const rate = 1.1;
    return { result: input.amount * rate, rate };
  }
}

@App({
  name: 'currency-api',
  tools: [ConvertCurrencyTool],
})
class CurrencyApp {}

@FrontMcp({
  info: { name: 'serverless-server', version: '1.0.0' },
  apps: [CurrencyApp],
  transport: {
    sessionMode: 'stateless',
    protocol: 'stateless-api',
  },
})
class Server {}
```

## What This Demonstrates

- Using `sessionMode: 'stateless'` to disable session management
- Using the `'stateless-api'` preset: no SSE, no streaming, pure request/response
- Each request is standalone with no server-side state between invocations
- Required for serverless targets (Vercel, Lambda, Cloudflare Workers)

## Related

- See `configure-transport` for the full transport configuration reference
- See `configure-transport-protocol-presets` for all preset options
