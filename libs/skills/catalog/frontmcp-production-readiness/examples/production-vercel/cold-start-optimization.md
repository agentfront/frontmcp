---
name: cold-start-optimization
reference: production-vercel
level: intermediate
description: 'Shows how to minimize cold start time by lazy-loading dependencies, avoiding heavy initialization at module scope, and caching expensive operations.'
tags: [production, vercel, openapi, performance, cold, start]
features:
  - 'Lazy-loading heavy dependencies via dynamic `import()` in `onInit()` instead of module scope'
  - 'Caching expensive fetches (e.g., OpenAPI specs) across warm invocations'
  - 'Keeping the module scope lightweight with no side effects'
  - 'No `top-level await`, no global state, no network calls at import time'
---

# Cold Start Optimization for Serverless

Shows how to minimize cold start time by lazy-loading dependencies, avoiding heavy initialization at module scope, and caching expensive operations.

## Code

```typescript
// src/providers/lazy-api-client.provider.ts
import { Provider, ProviderScope } from '@frontmcp/sdk';

export const API_CLIENT = Symbol('ApiClient');

@Provider({ token: API_CLIENT, scope: ProviderScope.GLOBAL })
export class LazyApiClientProvider {
  // Lazy-loaded — not imported at module scope
  private client: unknown;

  async onInit(): Promise<void> {
    // Lazy-load heavy dependencies to reduce cold start time
    // The import only happens when the provider is first used
    const { HeavySDK } = await import('heavy-third-party-sdk');
    this.client = new HeavySDK({
      apiKey: process.env.API_KEY,
    });
  }

  getClient() {
    return this.client;
  }
}
```

```typescript
// src/tools/cached-lookup.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

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
// No top-level await, no global state, no network calls

@FrontMcp({
  info: { name: 'fast-start', version: '1.0.0' },
  apps: [MyApp],
  redis: { provider: 'vercel-kv' },
})
export default class FastStartServer {}
```

## What This Demonstrates

- Lazy-loading heavy dependencies via dynamic `import()` in `onInit()` instead of module scope
- Caching expensive fetches (e.g., OpenAPI specs) across warm invocations
- Keeping the module scope lightweight with no side effects
- No `top-level await`, no global state, no network calls at import time

## Related

- See `production-vercel` for the full cold start and edge runtime checklist
