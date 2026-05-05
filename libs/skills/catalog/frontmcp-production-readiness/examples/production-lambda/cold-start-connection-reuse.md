---
name: cold-start-connection-reuse
reference: production-lambda
level: intermediate
description: 'Shows how to minimize Lambda cold starts with lazy initialization (on first call, not in a fictional `onInit`) and the module-scope connection-reuse pattern for external services.'
tags: [production, lambda, performance, cold, start, connection]
features:
  - 'Connection reuse pattern: caching connections in module scope across warm invocations'
  - 'Lazy-loading heavy dependencies (`pg`) on first use, not at module scope'
  - 'Not closing connections on shutdown for Lambda (they survive freeze/thaw)'
  - 'Keeping module scope lightweight with no heavy initialization'
---

# Cold Start Optimization and Connection Reuse

Shows how to minimize Lambda cold starts with lazy initialization on first call and the module-scope connection-reuse pattern for external services.

> `@Provider`-decorated classes do NOT have `onInit` / `onDestroy` lifecycle hooks. Initialize lazily on first method call. For Lambda specifically, do **not** wire any shutdown hook for DB connections — Lambda freezes the execution context between invocations and your connection survives, so explicit close is wrong.

## Code

```typescript
// src/providers/db-connection.provider.ts
import { Provider, ProviderScope } from '@frontmcp/sdk';

export const DB_CLIENT = Symbol('DbClient');

// Module-scope cache — survives freeze/thaw between Lambda invocations.
let cachedConnectionPromise: Promise<unknown> | undefined;

@Provider({ token: DB_CLIENT, scope: ProviderScope.GLOBAL })
export class DbConnectionProvider {
  // Lazy on first getConnection() — heavy SDK import does not run at module load.
  async getConnection(): Promise<unknown> {
    if (!cachedConnectionPromise) {
      cachedConnectionPromise = (async () => {
        const { Client } = await import('pg');
        const client = new Client({
          host: process.env.DB_HOST,
          connectionTimeoutMillis: 5000, // Don't hang on connection attempts
        });
        await client.connect();
        return client;
      })();
    }
    return cachedConnectionPromise;
  }

  // Note: Do NOT close in any shutdown hook for Lambda — connection survives freeze/thaw.
}
```

```typescript
// src/tools/optimized-query.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

import { DB_CLIENT } from '../providers/db-connection.provider';

@Tool({
  name: 'query_data',
  description: 'Query data with connection reuse',
  inputSchema: {
    id: z.string().min(1).describe('Record ID'),
  },
  outputSchema: {
    id: z.string(),
    data: z.string(),
  },
})
export class OptimizedQueryTool extends ToolContext {
  async execute(input: { id: string }) {
    const db = this.get(DB_CLIENT) as { getConnection: () => Promise<{ query: Function }> };

    // Parameterized query — prevents SQL injection
    const conn = await db.getConnection();
    const result = await conn.query('SELECT * FROM records WHERE id = $1', [input.id]);

    if (!result.rows[0]) {
      this.fail(new Error(`Record not found: ${input.id}`));
    }

    return { id: input.id, data: JSON.stringify(result.rows[0]) };
  }
}
```

```typescript
// src/main.ts
import { FrontMcp } from '@frontmcp/sdk';

// Only import lightweight modules at the top level
// Heavy imports happen lazily in providers
import { MyApp } from './my.app';

// No heavy initialization at module scope
// No network calls, no database connections here

@FrontMcp({
  info: { name: 'fast-lambda', version: '1.0.0' },
  apps: [MyApp],
})
export default class FastLambdaServer {}
```

## What This Demonstrates

- Connection reuse pattern: caching the connection promise in module scope so it survives Lambda freeze/thaw
- Lazy-loading heavy dependencies (`pg`) via dynamic `import()` on first use, not at module load
- Not closing connections on shutdown for Lambda (they survive freeze/thaw — and providers have no `onDestroy` hook anyway)
- Keeping module scope lightweight with no heavy initialization

## Related

- See `production-lambda` for the full cold start and scaling checklist
