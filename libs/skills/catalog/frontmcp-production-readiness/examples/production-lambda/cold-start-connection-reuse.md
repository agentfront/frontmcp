---
name: cold-start-connection-reuse
reference: production-lambda
level: intermediate
description: 'Shows how to minimize Lambda cold starts with lazy initialization, tree-shaking, and the connection reuse pattern for external services.'
tags: [production, lambda, performance, cold, start, connection]
features:
  - 'Connection reuse pattern: caching connections in module scope across warm invocations'
  - 'Lazy-loading heavy dependencies (`pg`) via dynamic `import()` to reduce cold start'
  - 'Not closing connections in `onDestroy()` for Lambda (they survive freeze/thaw)'
  - 'Keeping module scope lightweight with no heavy initialization'
---

# Cold Start Optimization and Connection Reuse

Shows how to minimize Lambda cold starts with lazy initialization, tree-shaking, and the connection reuse pattern for external services.

## Code

```typescript
// src/providers/db-connection.provider.ts
import { Provider, ProviderScope } from '@frontmcp/sdk';

export const DB_CLIENT = Symbol('DbClient');

// Connection reuse pattern: connections survive between warm invocations
// but must handle cold starts and reconnection gracefully
let cachedConnection: unknown | undefined;

@Provider({ token: DB_CLIENT, scope: ProviderScope.GLOBAL })
export class DbConnectionProvider {
  private connection: unknown;

  async onInit(): Promise<void> {
    // Reuse connection across warm invocations
    if (cachedConnection) {
      this.connection = cachedConnection;
      return;
    }

    // Lazy-load the database driver — reduces cold start time
    const { Client } = await import('pg');
    this.connection = new Client({
      host: process.env.DB_HOST,
      connectionTimeoutMillis: 5000, // Don't hang on connection attempts
    });
    await (this.connection as { connect: () => Promise<void> }).connect();

    // Cache for warm invocations
    cachedConnection = this.connection;
  }

  getConnection() {
    return this.connection;
  }

  // Note: Don't close in onDestroy for Lambda — connection survives freeze/thaw
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
    const db = this.get(DB_CLIENT);

    // Parameterized query — prevents SQL injection
    const result = await (db as { getConnection: () => { query: Function } })
      .getConnection()
      .query('SELECT * FROM records WHERE id = $1', [input.id]);

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

- Connection reuse pattern: caching connections in module scope across warm invocations
- Lazy-loading heavy dependencies (`pg`) via dynamic `import()` to reduce cold start
- Not closing connections in `onDestroy()` for Lambda (they survive freeze/thaw)
- Keeping module scope lightweight with no heavy initialization

## Related

- See `production-lambda` for the full cold start and scaling checklist
