---
name: cold-start-optimization
reference: production-vercel
level: intermediate
description: Shows how to minimize cold start time by lazy-loading dependencies on first use, avoiding heavy initialization at module scope, and caching expensive operations across warm invocations.
tags:
  - production
  - vercel
  - openapi
  - performance
  - cold
  - start
features:
  - Lazy-loading heavy SDKs via dynamic `import()` on **first use**, not at module scope (and not in a fictional `Provider.onInit`)
  - Caching expensive fetches (e.g., OpenAPI specs) across warm invocations
  - Keeping the module scope lightweight with no side effects
  - No `top-level await` and no heavy global initialization or network calls at import time (lightweight module-scope caching of cheap synchronous values like `cachedSpec` is fine)
---

# Cold Start Optimization for Serverless

Shows how to minimize cold start time by lazy-loading dependencies on first use, avoiding heavy initialization at module scope, and caching expensive operations across warm invocations.

> `@Provider`-decorated classes do **not** have `onInit` / `onDestroy` lifecycle hooks. Initialize lazily on first method call inside the provider, or in the constructor if synchronous.

## Code

```typescript
// src/providers/lazy-api-client.provider.ts
import { Provider, ProviderScope } from '@frontmcp/sdk';

export const API_CLIENT = Symbol('ApiClient');

// Provider initializes lazily on first getClient() call — heavy SDK is
// not imported at module scope, so cold starts stay fast.
@Provider({ token: API_CLIENT, scope: ProviderScope.GLOBAL })
export class LazyApiClientProvider {
  private clientPromise: Promise<unknown> | undefined;

  async getClient(): Promise<unknown> {
    if (!this.clientPromise) {
      const promise = (async () => {
        const { HeavySDK } = await import('heavy-third-party-sdk');
        return new HeavySDK({ apiKey: process.env.API_KEY });
      })();
      // Reset on failure so a transient import/init error doesn't poison
      // the cache for every subsequent warm invocation.
      promise.catch(() => {
        if (this.clientPromise === promise) this.clientPromise = undefined;
      });
      this.clientPromise = promise;
    }
    return this.clientPromise;
  }
}
```

```typescript
// src/tools/cached-lookup.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

// Cache OpenAPI spec in module scope — survives warm invocations
let cachedSpec: unknown | undefined;

@Tool({
  name: 'lookup',
  description: 'Look up data using a cached API spec',
  inputSchema: {
    query: z.string().min(1).describe('Lookup query'),
  },
  outputSchema: {
    result: z.string(),
  },
})
export class CachedLookupTool extends ToolContext {
  async execute(input: { query: string }) {
    // Cache the spec — not fetched on every invocation
    if (!cachedSpec) {
      const response = await this.fetch('https://api.example.com/openapi.json');
      cachedSpec = await response.json();
    }

    // Use cached spec for the lookup
    return { result: `Found: ${input.query}` };
  }
}
```

```typescript
// src/main.ts
import { FrontMcp } from '@frontmcp/sdk';

// Only import lightweight modules at the top level
import { MyApp } from './my.app';

// No heavy initialization here — this runs on every cold start
// No top-level await and no heavy init at import time. The module-scope
// cachedSpec below is fine — it's a cheap synchronous value populated lazily.

@FrontMcp({
  info: { name: 'fast-start', version: '1.0.0' },
  apps: [MyApp],
  redis: { provider: 'vercel-kv' },
})
export default class FastStartServer {}
```

## What This Demonstrates

- Lazy-loading heavy SDKs via dynamic `import()` on **first use**, not at module scope (and not in a fictional `Provider.onInit`)
- Caching expensive fetches (e.g., OpenAPI specs) across warm invocations
- Keeping the module scope lightweight with no side effects
- No `top-level await` and no heavy global initialization or network calls at import time (lightweight module-scope caching of cheap synchronous values like `cachedSpec` is fine)

## Related

- See `production-vercel` for the full cold start and edge runtime checklist
