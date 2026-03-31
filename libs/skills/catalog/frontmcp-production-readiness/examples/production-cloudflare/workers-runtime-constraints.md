---
name: workers-runtime-constraints
reference: production-cloudflare
level: intermediate
description: 'Shows how to write tools that are compatible with the Cloudflare Workers runtime: no Node.js APIs, no eval, only async I/O, and using Web APIs.'
tags: [production, cloudflare, node, workers, runtime, constraints]
features:
  - 'Using `@frontmcp/utils` for crypto instead of `node:crypto` (Workers use V8 isolates, not Node)'
  - 'All I/O is async (no synchronous blocking operations allowed in Workers)'
  - 'No `eval()` or dynamic `Function()` (prohibited in Workers)'
  - 'No filesystem access (Workers have no filesystem)'
  - 'Using Fetch API via `this.fetch()` instead of Node.js `http`/`https`'
---

# Workers Runtime Constraints and Compatibility

Shows how to write tools that are compatible with the Cloudflare Workers runtime: no Node.js APIs, no eval, only async I/O, and using Web APIs.

## Code

```typescript
// src/tools/worker-safe.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
// Use @frontmcp/utils — wraps Web Crypto API, works in Workers
import { sha256Hex, randomUUID, base64urlEncode } from '@frontmcp/utils';

@Tool({
  name: 'transform_data',
  description: 'Transform and hash data in a Workers-compatible way',
  inputSchema: {
    payload: z.string().min(1).describe('Data to transform'),
  },
  outputSchema: {
    id: z.string(),
    hash: z.string(),
    encoded: z.string(),
    timestamp: z.string(),
  },
})
export class TransformDataTool extends ToolContext {
  async execute(input: { payload: string }) {
    // All operations are async — no synchronous blocking

    // Cross-platform crypto (Web Crypto under the hood)
    const id = randomUUID();
    const hash = sha256Hex(input.payload);
    const encoded = base64urlEncode(input.payload);

    // Use this.fetch() — standard Fetch API, not node http
    const response = await this.fetch('https://api.example.com/transform', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, payload: input.payload }),
    });

    if (!response.ok) {
      this.fail(new Error(`Transform API error: ${response.status}`));
    }

    return {
      id,
      hash,
      encoded,
      timestamp: new Date().toISOString(),
    };
  }
}
```

```typescript
// src/providers/kv-store.provider.ts
import { Provider, ProviderScope } from '@frontmcp/sdk';

export const KV_STORE = Symbol('KvStore');

// Workers KV — no filesystem, no eval, no dynamic Function()
@Provider({ token: KV_STORE, scope: ProviderScope.GLOBAL })
export class KvStoreProvider {
  // Workers KV is bound via wrangler.toml, accessed from env
  async get(key: string): Promise<string | null> {
    // In Workers, KV is available via the environment binding
    // This is a pattern — actual binding depends on your worker setup
    return null;
  }

  async put(key: string, value: string, ttlSeconds?: number): Promise<void> {
    // KV put with optional TTL
  }
}
```

## What This Demonstrates

- Using `@frontmcp/utils` for crypto instead of `node:crypto` (Workers use V8 isolates, not Node)
- All I/O is async (no synchronous blocking operations allowed in Workers)
- No `eval()` or dynamic `Function()` (prohibited in Workers)
- No filesystem access (Workers have no filesystem)
- Using Fetch API via `this.fetch()` instead of Node.js `http`/`https`

## Related

- See `production-cloudflare` for the full Workers runtime and performance checklist
