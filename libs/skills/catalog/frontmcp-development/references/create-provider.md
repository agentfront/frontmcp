---
name: create-provider
description: Create singleton DI providers for database pools, API clients, and shared services
---

# Creating Providers (Dependency Injection)

Providers are singleton services — database pools, API clients, config objects — that tools, resources, prompts, and agents can access via `this.get(token)`.

## When to Use This Skill

### Must Use

- Multiple tools, resources, or agents need a shared database connection pool
- API clients or external service connections must be singleton (not recreated per request)
- You need async one-time setup before any tool runs (use `AsyncProvider({ useFactory })`)

### Recommended

- Centralizing configuration values as a type-safe injectable object
- Sharing a cache layer (Map, Redis) across all execution contexts
- Providing environment-specific settings (API URLs, feature flags) via DI

### Skip When

- The service is only used by a single tool and has no lifecycle (inline it in the tool)
- You need to build an executable action for AI clients (see `create-tool`)
- You need autonomous LLM-driven orchestration (see `create-agent`)

> **Decision:** Use this skill when you need a shared, singleton service that tools, resources, and agents access via `this.get(token)`. `@Provider` does **not** support `onInit`/`onDestroy` lifecycle hooks — use the constructor for sync setup, `AsyncProvider({ useFactory })` for async setup, and an explicit method (e.g., `close()`) plus the framework's shutdown path for cleanup.

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

`@Provider` is a class decorator. There are two patterns depending on whether
your provider needs async setup:

**Pattern A — sync setup (no async I/O at boot):** decorate the class, do the
work in the constructor.

```typescript
import { Provider } from '@frontmcp/sdk';

@Provider({ name: 'ConfigProvider' })
class ConfigProvider {
  // Constructor runs synchronously the first time the class is resolved;
  // a thrown error here aborts startup (fail-fast).
  readonly apiBaseUrl = process.env.API_BASE_URL ?? 'https://api.example.com';
  readonly maxRetries = Number(process.env.MAX_RETRIES ?? 3);
}
```

**Pattern B — async setup (e.g., open a connection pool):** use `AsyncProvider`
factory. The framework `await`s `useFactory` before any tool can resolve the
token, so the pool is guaranteed to be open by the time `this.get(...)` returns.

```typescript
import { createPool, type Pool } from 'your-db-driver';

import { AsyncProvider, ProviderScope } from '@frontmcp/sdk';

class DatabasePool implements DatabaseService {
  constructor(private readonly pool: Pool) {}

  async query(sql: string, params?: unknown[]) {
    return this.pool.query(sql, params);
  }

  async close() {
    // `@Provider` has no `onDestroy` hook. Expose explicit cleanup as a
    // method and call it from the host (e.g., before `server.dispose()`)
    // when the provider owns network/file handles that need to drain.
    await this.pool.end();
  }
}

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

## Step 3: Register in @App or @FrontMcp

```typescript
@App({
  name: 'MyApp',
  providers: [databaseProvider], // App-scoped provider (factory)
  tools: [QueryTool, InsertTool],
})
class MyApp {}

// OR at server level (shared across all apps)
@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  providers: [databaseProvider], // Server-scoped provider
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
  // No `onInit` hook — read env in the constructor and fail fast on missing values.
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor() {
    const baseUrl = process.env.API_URL;
    const apiKey = process.env.API_KEY;
    if (!baseUrl || !apiKey) {
      throw new Error('ApiClientProvider: API_URL and API_KEY must be set');
    }
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
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

`@Provider` classes have **no** `onInit` / `onDestroy` lifecycle hooks. Choose the right setup pattern for your provider:

| Setup need                                 | Pattern                                                               | Cleanup                                                 |
| ------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------- |
| Sync — read env, build a Map, etc.         | `@Provider({ name })` + constructor (throw on missing config)         | None / GC (or expose a `close()` and call from host)    |
| Async — open a pool, fetch a remote schema | `AsyncProvider({ provide, name, scope, useFactory })` factory binding | Expose `close()`/`stop()`; framework dispose runs first |
| Singleton with no setup (e.g., a `Map`)    | `@Provider({ name })` on the class                                    | None                                                    |

`AsyncProvider` factories are awaited in dependency order before any tool can resolve the bound token, so async setup completes before user code runs.

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

## Common Patterns

| Pattern            | Correct                                                                | Incorrect                                        | Why                                                                                         |
| ------------------ | ---------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Token definition   | `const DB: Token<DbService> = Symbol('DbService')` (typed Symbol)      | `const DB = 'database'` (string literal)         | Typed `Token<T>` enables compile-time type checking on `this.get()`                         |
| DI resolution      | `this.get(TOKEN)` with error handling                                  | `this.tryGet(TOKEN)!` with non-null assertion    | `get` throws a clear `DependencyNotFoundError`; non-null assertions hide failures           |
| Lifecycle          | `AsyncProvider({ useFactory })` for async setup; constructor for sync  | Using `onInit()` / `onDestroy()` lifecycle hooks | `@Provider` has no lifecycle hooks; `AsyncProvider` factories are awaited before resolution |
| Registration scope | Register at `@App` level for app-scoped, `@FrontMcp` for server-scoped | Registering same provider in multiple apps       | Server-scoped providers are shared; duplicating causes multiple instances                   |
| Config provider    | `readonly` properties from `process.env`                               | Mutable properties that change at runtime        | Providers are singletons; mutable state can cause race conditions                           |

## Verification Checklist

### Configuration

- [ ] Provider class has `@Provider` decorator with `name` (or factory uses `AsyncProvider`)
- [ ] Token is defined with `Token<T>` using a `Symbol` and typed interface
- [ ] Provider (class or `AsyncProvider` factory) is registered in `providers` array of `@App` or `@FrontMcp`
- [ ] Sync setup happens in the constructor (throws fast on missing config)
- [ ] Async setup uses `AsyncProvider({ useFactory })`; the framework awaits it before resolution

### Runtime

- [ ] Server starts without provider initialization errors
- [ ] `this.get(TOKEN)` resolves the provider in tools, resources, and agents
- [ ] Provider is a singleton (same instance across all contexts)
- [ ] Resource-owning providers expose an explicit `close()` / `stop()` method that the host calls before `server.dispose()`
- [ ] Missing provider throws `DependencyNotFoundError` with a clear message

## Troubleshooting

| Problem                                | Cause                                                   | Solution                                                                                      |
| -------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `DependencyNotFoundError` at runtime   | Provider not registered in scope                        | Add provider (class or `AsyncProvider` factory) to `providers` array in `@App` or `@FrontMcp` |
| Provider constructor throws at startup | Missing environment variable or unreachable service     | Validate env in the constructor; restart with the missing config supplied                     |
| `AsyncProvider` factory rejects        | Async setup error (DB unreachable, schema fetch failed) | The factory error aborts boot — fix the dependency or wrap with retry inside `useFactory`     |
| Multiple instances of same provider    | Registered in multiple apps instead of server level     | Move to `@FrontMcp` `providers` for shared, server-scoped access                              |
| Type mismatch on `this.get(TOKEN)`     | Token typed with wrong interface                        | Ensure `Token<T>` generic matches the provider's implemented interface                        |
| Resources leak on shutdown             | No explicit cleanup method exposed                      | Add a `close()` / `stop()` method and call it from the host before `server.dispose()`         |

## Examples

| Example                                                                               | Level        | Description                                                                                                                                   |
| ------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [`basic-database-provider`](../examples/create-provider/basic-database-provider.md)   | Basic        | A provider that manages a database connection pool, bound through `AsyncProvider({ useFactory })` so the pool is opened before any tool runs. |
| [`config-and-api-providers`](../examples/create-provider/config-and-api-providers.md) | Intermediate | A configuration provider with readonly environment settings and an HTTP API client provider.                                                  |

> See all examples in [`examples/create-provider/`](../examples/create-provider/)

## Reference

- [Providers Documentation](https://docs.agentfront.dev/frontmcp/extensibility/providers)
- Related skills: `create-tool`, `create-resource`, `create-agent`, `create-prompt`
