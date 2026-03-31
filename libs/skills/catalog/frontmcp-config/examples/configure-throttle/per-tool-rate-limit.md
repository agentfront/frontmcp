---
name: per-tool-rate-limit
reference: configure-throttle
level: intermediate
description: 'Override server defaults with per-tool rate limits and concurrency caps.'
tags: [config, session, throttle, per, tool, rate]
features:
  - 'Setting per-tool `rateLimit`, `concurrency`, and `timeout` on the `@Tool` decorator'
  - "Using `partitionBy: 'session'` for per-user fairness on expensive tools"
  - 'Setting `queueTimeoutMs` to briefly queue excess requests instead of rejecting immediately'
  - 'Tools without overrides (`QuickLookupTool`) inherit server defaults'
---

# Per-Tool Rate Limiting

Override server defaults with per-tool rate limits and concurrency caps.

## Code

```typescript
// src/server.ts
import { FrontMcp, App, Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'expensive_query',
  description: 'Run an expensive database query',
  inputSchema: { query: z.string() },
  outputSchema: { rows: z.array(z.record(z.unknown())), rowCount: z.number() },
  rateLimit: {
    maxRequests: 10,
    windowMs: 60000,
    partitionBy: 'session', // per-session rate limit
  },
  concurrency: {
    maxConcurrent: 3,
    queueTimeoutMs: 5000, // wait up to 5s for a slot
    partitionBy: 'session',
  },
  timeout: {
    executeMs: 60000, // 60 second timeout for this tool
  },
})
class ExpensiveQueryTool extends ToolContext {
  async execute(input: { query: string }) {
    return { rows: [{ id: 1 }], rowCount: 1 };
  }
}

@Tool({
  name: 'quick_lookup',
  description: 'Fast key-value lookup',
  inputSchema: { key: z.string() },
  outputSchema: { value: z.string().nullable() },
  // No overrides -- uses server defaults
})
class QuickLookupTool extends ToolContext {
  async execute(input: { key: string }) {
    return { value: 'cached-value' };
  }
}

@App({
  name: 'data-api',
  tools: [ExpensiveQueryTool, QuickLookupTool],
})
class DataApp {}

@FrontMcp({
  info: { name: 'data-server', version: '1.0.0' },
  apps: [DataApp],
  throttle: {
    enabled: true,
    defaultRateLimit: { maxRequests: 100, windowMs: 60000 },
    defaultConcurrency: { maxConcurrent: 10 },
    defaultTimeout: { executeMs: 30000 },
  },
})
class Server {}
```

## What This Demonstrates

- Setting per-tool `rateLimit`, `concurrency`, and `timeout` on the `@Tool` decorator
- Using `partitionBy: 'session'` for per-user fairness on expensive tools
- Setting `queueTimeoutMs` to briefly queue excess requests instead of rejecting immediately
- Tools without overrides (`QuickLookupTool`) inherit server defaults

## Related

- See `configure-throttle` for the full throttle configuration reference
- See `configure-throttle-guard-config` for the complete GuardConfig interface
