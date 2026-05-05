---
name: basic-database-provider
reference: create-provider
level: basic
description: A provider that manages a database connection pool, bound through `AsyncProvider({ useFactory })` so the pool is opened before any tool runs.
tags: [development, database, provider]
features:
  - 'Defining a typed token with `Token<T>` using a `Symbol` for DI identification'
  - 'Using `AsyncProvider({ provide, name, scope, useFactory })` so async setup completes before tool execution'
  - 'Consuming the provider in a tool via `this.get(DB_TOKEN)` with full type safety'
  - 'Registering the factory in the `providers` array so tools can resolve it'
---

# Basic Database Provider with Async Setup

A provider that manages a database connection pool, bound through `AsyncProvider({ useFactory })` so the pool is opened before any tool runs.

## Code

```typescript
// src/apps/main/tokens.ts
import type { Token } from '@frontmcp/di';

export interface DatabaseService {
  query(sql: string, params?: unknown[]): Promise<unknown[]>;
  close(): Promise<void>;
}

export const DB_TOKEN: Token<DatabaseService> = Symbol('DatabaseService');
```

```typescript
// src/apps/main/providers/database.provider.ts
import { createPool, type Pool } from 'your-db-driver';

import { AsyncProvider, ProviderScope } from '@frontmcp/sdk';

import { DB_TOKEN, type DatabaseService } from '../tokens';

class DatabasePool implements DatabaseService {
  constructor(private readonly pool: Pool) {}

  async query(sql: string, params?: unknown[]) {
    return this.pool.query(sql, params);
  }

  async close() {
    await this.pool.end();
  }
}

// `@Provider` does NOT support `onInit`/`onDestroy` lifecycle hooks. For async
// setup, register the dependency via `AsyncProvider({ useFactory })` — the
// framework awaits `useFactory` before any tool can resolve the token.
export const databaseProvider = AsyncProvider({
  provide: DB_TOKEN,
  name: 'DatabaseProvider',
  scope: ProviderScope.GLOBAL,
  inject: () => [] as const,
  useFactory: async (): Promise<DatabaseService> => {
    const pool = await createPool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
    });
    return new DatabasePool(pool);
  },
});
```

```typescript
// src/apps/main/tools/query-users.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

import { DB_TOKEN } from '../tokens';

@Tool({
  name: 'query_users',
  description: 'Query users from the database',
  inputSchema: {
    filter: z.string().optional(),
    limit: z.number().default(10),
  },
  outputSchema: {
    users: z.array(z.object({ id: z.string(), name: z.string(), email: z.string() })),
  },
})
class QueryUsersTool extends ToolContext {
  async execute(input: { filter?: string; limit: number }) {
    const db = this.get(DB_TOKEN);
    const users = await db.query('SELECT id, name, email FROM users WHERE name LIKE $1 LIMIT $2', [
      `%${input.filter ?? ''}%`,
      input.limit,
    ]);
    return { users };
  }
}
```

```typescript
// src/apps/main/index.ts
import { App } from '@frontmcp/sdk';

import { databaseProvider } from './providers/database.provider';
import QueryUsersTool from './tools/query-users.tool';

@App({
  name: 'main',
  providers: [databaseProvider],
  tools: [QueryUsersTool],
})
class MainApp {}
```

## What This Demonstrates

- Defining a typed token with `Token<T>` using a `Symbol` for DI identification
- Using `AsyncProvider({ provide, name, scope, useFactory })` so async setup completes before tool execution
- Consuming the provider in a tool via `this.get(DB_TOKEN)` with full type safety
- Registering the factory in the `providers` array so tools can resolve it

## Related

- See `create-provider` for configuration providers, HTTP API clients, and cache providers
- See `create-tool` for more patterns using DI in tool execution
