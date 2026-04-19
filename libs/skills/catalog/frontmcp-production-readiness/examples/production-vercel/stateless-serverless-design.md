---
name: stateless-serverless-design
reference: production-vercel
level: advanced
description: 'Shows a fully stateless server design that works on Vercel edge runtime with no Node.js-only APIs, using `@frontmcp/utils` for cross-platform crypto.'
tags: [production, vercel, serverless, node, stateless, design]
features:
  - 'Using `@frontmcp/utils` (`sha256Hex`, `randomUUID`) instead of `node:crypto` for edge compatibility'
  - 'Fully stateless design with no in-memory state between invocations'
  - 'Using `this.fetch()` instead of Node.js `http`/`https` modules'
  - 'No file system access (serverless is ephemeral)'
---

# Stateless Serverless Design with Edge Compatibility

Shows a fully stateless server design that works on Vercel edge runtime with no Node.js-only APIs, using `@frontmcp/utils` for cross-platform crypto.

## Code

```typescript
// src/tools/edge-safe-tool.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';
// Use @frontmcp/utils for cross-platform crypto — not node:crypto
import { randomUUID, sha256Hex } from '@frontmcp/utils';

@Tool({
  name: 'process_request',
  description: 'Process a request in an edge-safe, stateless manner',
  inputSchema: {
    data: z.string().min(1).describe('Request data'),
  },
  outputSchema: {
    requestId: z.string(),
    hash: z.string(),
    processed: z.boolean(),
  },
})
export class ProcessRequestTool extends ToolContext {
  async execute(input: { data: string }) {
    // Cross-platform crypto — works on edge runtime
    const requestId = randomUUID();
    const hash = sha256Hex(input.data);

    // No file system access — serverless is ephemeral
    // No in-memory state — each invocation is independent
    // Use this.fetch() for external calls (not node http/https)
    const response = await this.fetch('https://api.example.com/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, hash, data: input.data }),
    });

    const result = await response.json();
    return { requestId, hash, processed: result.ok };
  }
}
```

```typescript
// src/main.ts
import { FrontMcp } from '@frontmcp/sdk';

import { EdgeApp } from './edge.app';

@FrontMcp({
  info: { name: 'edge-server', version: '1.0.0' },
  apps: [EdgeApp],

  // Vercel KV for all shared state
  redis: { provider: 'vercel-kv' },

  // CORS restricted to production domain
  cors: {
    origin: ['https://app.example.com'],
  },

  // Stateless: no file system, no SQLite, no in-memory sessions
})
export default class EdgeServer {}
```

## What This Demonstrates

- Using `@frontmcp/utils` (`sha256Hex`, `randomUUID`) instead of `node:crypto` for edge compatibility
- Fully stateless design with no in-memory state between invocations
- Using `this.fetch()` instead of Node.js `http`/`https` modules
- No file system access (serverless is ephemeral)

## Related

- See `production-vercel` for the full edge runtime and scaling checklist
