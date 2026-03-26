---
name: create-provider
description: Create dependency injection providers for database connections, API clients, and singleton services. Use when tools and resources need shared services, DB pools, or configuration objects.
tags: [provider, di, dependency-injection, singleton, database, service]
parameters:
  - name: name
    description: Provider name
    type: string
    required: true
examples:
  - scenario: Create a database connection pool provider
    expected-outcome: Singleton DB pool injectable into all tools via this.get()
  - scenario: Create a config provider from environment variables
    expected-outcome: Type-safe config object available in any context
priority: 8
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/extensibility/providers
---

# Creating Providers (Dependency Injection)

Providers are singleton services — database pools, API clients, config objects — that tools, resources, prompts, and agents can access via `this.get(token)`.

## When to Use

Create a provider when:

- Multiple tools need the same database connection pool
- You have API clients that should be shared (not recreated per request)
- Configuration values should be centralized and type-safe
- You need lifecycle management (initialize on startup, cleanup on shutdown)

## Step 1: Define a Token

Tokens identify providers in the DI container:

```typescript
import type { Token } from '@frontmcp/di';

// Define a typed token
interface DatabaseService {
  query(sql: string, params?: unknown[]): Promise<unknown[]>;
  close(): Promise<void>;
}

const DB_TOKEN: Token<DatabaseService> = Symbol('DatabaseService');
```

## Step 2: Create the Provider

```typescript
import { Provider } from '@frontmcp/sdk';
import { createPool, Pool } from 'your-db-driver';

@Provider({ name: 'DatabaseProvider' })
class DatabaseProvider implements DatabaseService {
  private pool!: Pool;

  async onInit() {
    // Called once when server starts
    this.pool = await createPool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
    });
  }

  async query(sql: string, params?: unknown[]) {
    return this.pool.query(sql, params);
  }

  async onDestroy() {
    // Called when server shuts down
    await this.pool.end();
  }
}
```

## Step 3: Register in @App or @FrontMcp

```typescript
@App({
  name: 'MyApp',
  providers: [DatabaseProvider], // App-scoped provider
  tools: [QueryTool, InsertTool],
})
class MyApp {}

// OR at server level (shared across all apps)
@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  providers: [DatabaseProvider], // Server-scoped provider
})
class Server {}
```

## Step 4: Use in Tools

Access providers via `this.get(token)` in any context (ToolContext, ResourceContext, PromptContext, AgentContext):

```typescript
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
    const db = this.get(DB_TOKEN); // Get the database provider
    const users = await db.query('SELECT id, name, email FROM users WHERE name LIKE $1 LIMIT $2', [
      `%${input.filter ?? ''}%`,
      input.limit,
    ]);
    return { users };
  }
}
```

### Safe Access

```typescript
// Throws if not registered
const db = this.get(DB_TOKEN);

// Returns undefined if not registered
const db = this.tryGet(DB_TOKEN);
if (!db) {
  this.fail(new Error('Database not configured'));
}
```

## Common Provider Patterns

### Configuration Provider

```typescript
interface AppConfig {
  apiBaseUrl: string;
  maxRetries: number;
  debug: boolean;
}

const CONFIG_TOKEN: Token<AppConfig> = Symbol('AppConfig');

@Provider({ name: 'ConfigProvider' })
class ConfigProvider implements AppConfig {
  readonly apiBaseUrl = process.env.API_BASE_URL ?? 'https://api.example.com';
  readonly maxRetries = Number(process.env.MAX_RETRIES ?? 3);
  readonly debug = process.env.DEBUG === 'true';
}
```

### HTTP API Client Provider

```typescript
interface ApiClient {
  get(path: string): Promise<unknown>;
  post(path: string, body: unknown): Promise<unknown>;
}

const API_TOKEN: Token<ApiClient> = Symbol('ApiClient');

@Provider({ name: 'ApiClientProvider' })
class ApiClientProvider implements ApiClient {
  private baseUrl!: string;
  private apiKey!: string;

  async onInit() {
    this.baseUrl = process.env.API_URL!;
    this.apiKey = process.env.API_KEY!;
  }

  async get(path: string) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    return res.json();
  }

  async post(path: string, body: unknown) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }
}
```

### Cache Provider

```typescript
const CACHE_TOKEN: Token<Map<string, unknown>> = Symbol('Cache');

@Provider({ name: 'CacheProvider' })
class CacheProvider extends Map<string, unknown> {
  // Map is already a valid provider - no lifecycle needed
}
```

## Provider Lifecycle

| Method        | When Called             | Use For                          |
| ------------- | ----------------------- | -------------------------------- |
| `onInit()`    | Server startup (async)  | Open connections, load config    |
| `onDestroy()` | Server shutdown (async) | Close connections, flush buffers |

Providers are initialized in dependency order — if Provider A depends on Provider B, B initializes first.

## Nx Generator

```bash
nx generate @frontmcp/nx:provider my-provider --project=my-app
```

## Verification

```bash
# Start server — providers initialize on startup
frontmcp dev

# Call a tool that uses the provider
# If provider fails to init, you'll see an error at startup
```
