---
name: durable-objects-state
reference: production-cloudflare
level: advanced
description: 'Shows how to use Cloudflare Durable Objects for stateful coordination alongside the stateless Workers runtime, with KV for cache and R2 for blob storage.'
tags: [production, cloudflare, cache, throttle, durable, objects]
features:
  - 'Using Durable Objects for stateful coordination (rate limiting) in an ephemeral Workers runtime'
  - 'Using R2 for blob/file storage since Workers have no filesystem'
  - 'Combining KV (cache), R2 (files), and Durable Objects (state) in one deployment'
  - 'Wrangler configuration with all three binding types'
---

# Stateful Coordination with Durable Objects

Shows how to use Cloudflare Durable Objects for stateful coordination alongside the stateless Workers runtime, with KV for cache and R2 for blob storage.

## Code

```toml
# wrangler.toml — with Durable Objects and R2
name = "stateful-mcp-worker"
main = "dist/worker.js"
compatibility_date = "2024-01-01"

# KV for cache
[[kv_namespaces]]
binding = "CACHE"
id = "cache-namespace-id"

# R2 for blob/file storage
[[r2_buckets]]
binding = "FILES"
bucket_name = "mcp-files"

# Durable Objects for stateful coordination
[durable_objects]
bindings = [
  { name = "RATE_LIMITER", class_name = "RateLimiterDO" }
]

[[migrations]]
tag = "v1"
new_classes = ["RateLimiterDO"]
```

```typescript
// src/tools/rate-limited-action.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'rate_limited_action',
  description: 'An action that uses Durable Objects for distributed rate limiting',
  inputSchema: {
    userId: z.string().min(1).describe('User identifier'),
    action: z.string().min(1).describe('Action to perform'),
  },
  outputSchema: {
    allowed: z.boolean(),
    remaining: z.number(),
    action: z.string(),
  },
})
export class RateLimitedActionTool extends ToolContext {
  async execute(input: { userId: string; action: string }) {
    // Durable Objects provide stateful rate limiting across Workers instances
    // Each user gets their own Durable Object instance for consistent state
    const result = await this.fetch(`https://internal/rate-check/${input.userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: input.action }),
    });

    const { allowed, remaining } = await result.json();

    if (!allowed) {
      this.fail(new Error(`Rate limit exceeded for user ${input.userId}`));
    }

    return { allowed, remaining, action: input.action };
  }
}
```

```typescript
// src/tools/file-upload.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'upload_file',
  description: 'Upload a file to R2 object storage',
  inputSchema: {
    filename: z.string().min(1).describe('File name'),
    content: z.string().min(1).describe('File content (base64 encoded)'),
  },
  outputSchema: {
    key: z.string(),
    url: z.string(),
    size: z.number(),
  },
})
export class FileUploadTool extends ToolContext {
  async execute(input: { filename: string; content: string }) {
    // R2 for blob/file storage — no filesystem in Workers
    const key = `uploads/${Date.now()}-${input.filename}`;
    const size = input.content.length;

    return { key, url: `https://files.example.com/${key}`, size };
  }
}
```

## What This Demonstrates

- Using Durable Objects for stateful coordination (rate limiting) in an ephemeral Workers runtime
- Using R2 for blob/file storage since Workers have no filesystem
- Combining KV (cache), R2 (files), and Durable Objects (state) in one deployment
- Wrangler configuration with all three binding types

## Related

- See `production-cloudflare` for the full storage and scaling checklist
