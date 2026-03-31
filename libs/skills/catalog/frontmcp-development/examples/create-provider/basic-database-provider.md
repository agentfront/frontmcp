---
name: basic-database-provider
reference: create-provider
level: basic
description: 'A provider that manages a database connection pool with `onInit()` and `onDestroy()` lifecycle hooks.'
tags: [development, database, provider]
features:
  - 'Defining a typed token with `Token<T>` using a `Symbol` for DI identification'
  - 'Using `@Provider` decorator with `onInit()` for async startup and `onDestroy()` for cleanup'
  - 'Consuming the provider in a tool via `this.get(DB_TOKEN)` with full type safety'
  - 'Registering the provider in the `providers` array so tools can resolve it'
---

# Basic Database Provider with Lifecycle

A provider that manages a database connection pool with `onInit()` and `onDestroy()` lifecycle hooks.

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
import { Provider } from '@frontmcp/sdk';
import { createPool, Pool } from 'your-db-driver';

@Provider({ name: 'DatabaseProvider' })
class DatabaseProvider implements DatabaseService {
  private pool!: Pool;

  async onInit() {
    this.pool = await createPool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
    });
  }

  async query(sql: string, params?: unknown[]) {
    return this.pool.query(sql, params);
  }

  async close() {
    await this.pool.end();
  }

  async onDestroy() {
    await this.pool.end();
  }
}
```

```typescript
// src/apps/main/tools/query-users.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
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

@App({
  name: 'main',
  providers: [DatabaseProvider],
  tools: [QueryUsersTool],
})
class MainApp {}
```

## What This Demonstrates

- Defining a typed token with `Token<T>` using a `Symbol` for DI identification
- Using `@Provider` decorator with `onInit()` for async startup and `onDestroy()` for cleanup
- Consuming the provider in a tool via `this.get(DB_TOKEN)` with full type safety
- Registering the provider in the `providers` array so tools can resolve it

## Related

- See `create-provider` for configuration providers, HTTP API clients, and cache providers
- See `create-tool` for more patterns using DI in tool execution
