---
name: server-level-rate-limit
reference: configure-throttle
level: basic
description: 'Configure global rate limits and IP filtering at the server level.'
tags: [config, throttle, level, rate, limit]
features:
  - 'Enabling throttle with `throttle: { enabled: true }`'
  - 'Setting `global` rate limit shared across all clients'
  - 'Configuring `globalConcurrency` to cap simultaneous executions'
  - 'Setting `defaultTimeout` to prevent runaway tool executions'
  - 'Using `ipFilter` with deny-by-default posture and an explicit allow list'
---

# Server-Level Rate Limiting

Configure global rate limits and IP filtering at the server level.

## Code

```typescript
// src/server.ts
import { FrontMcp, App, Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'search',
  description: 'Search records',
  inputSchema: { query: z.string() },
  outputSchema: { results: z.array(z.string()) },
})
class SearchTool extends ToolContext {
  async execute(input: { query: string }) {
    return { results: [`Result for: ${input.query}`] };
  }
}

@App({
  name: 'api',
  tools: [SearchTool],
})
class ApiApp {}

@FrontMcp({
  info: { name: 'throttled-server', version: '1.0.0' },
  apps: [ApiApp],
  throttle: {
    enabled: true,
    global: {
      maxRequests: 1000,
      windowMs: 60000, // 1 minute window
      partitionBy: 'global',
    },
    globalConcurrency: {
      maxConcurrent: 50,
      partitionBy: 'global',
    },
    defaultTimeout: {
      executeMs: 30000, // 30 second timeout
    },
    ipFilter: {
      allowList: ['10.0.0.0/8'],
      defaultAction: 'deny',
      trustProxy: true,
      trustedProxyDepth: 1,
    },
  },
})
class Server {}
```

## What This Demonstrates

- Enabling throttle with `throttle: { enabled: true }`
- Setting `global` rate limit shared across all clients
- Configuring `globalConcurrency` to cap simultaneous executions
- Setting `defaultTimeout` to prevent runaway tool executions
- Using `ipFilter` with deny-by-default posture and an explicit allow list

## Related

- See `configure-throttle` for the full throttle configuration reference
- See `configure-throttle-guard-config` for the complete GuardConfig interface
