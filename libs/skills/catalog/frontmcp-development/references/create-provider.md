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

## File Layout

Once a provider grows past a single class, a flat `src/providers/<slug>.provider.ts` becomes ambiguous: helpers, internal types, schema fragments, and the spec file all need somewhere to go. The recommended convention is **one folder per provider**, co-locating the class, the spec, an optional barrel, and any helpers:

```text
src/providers/<provider-slug>/
├── index.ts                            # barrel: re-exports class, factory, public types
├── <provider-slug>.provider.ts         # @Provider class and/or AsyncProvider factory
├── <provider-slug>.provider.spec.ts    # unit tests
├── types.ts                            # (optional) internal types / token interfaces
└── <helper>.ts (+ .spec.ts)            # (optional) per-provider helpers
```

Plus a top-level `src/providers/index.ts` barrel re-exporting each subfolder:

```typescript
// src/providers/index.ts
export * from './task-store';
export * from './config';
export * from './redis';
```

### Naming rules

- **Folder slug**: `kebab-case`, matches the provider's primary purpose (`task-store`, `redis`, `api-client`).
- **Class file**: `<slug>.provider.ts` — matches the in-tree demo-app convention (`apps/demo/src/apps/expenses/providers/redis.provider.ts`) and what the Nx generator emits.
- **Spec file**: `<slug>.provider.spec.ts` — co-located with source per the repo's `.spec.ts` convention (CLAUDE.md).
- **Barrel**: `index.ts`, re-exporting the class, the `AsyncProvider` factory (if any), and any public types/tokens.

### Single-file vs folder — when to fold

A trivial provider (e.g. a `Map`-based cache, a pure DTO with no helpers) does NOT need its own folder; promote to a folder as soon as the provider grows. Use this rubric:

| Provider shape                                         | Layout                                                  | Why                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Pure DTO (e.g. `extends Map`, no methods, no helpers)  | Single file `<slug>.provider.ts` under `src/providers/` | A folder for a 5-line class is over-architected                                |
| Provider with a spec file                              | Folder                                                  | Keeps source and spec adjacent; matches CLAUDE.md `.spec.ts` rule              |
| Provider with helpers, types, or schema fragments      | Folder                                                  | Helpers/types are private to the provider; folder boundary makes that explicit |
| `AsyncProvider({ useFactory })` with non-trivial setup | Folder                                                  | Factory + class + setup helpers cluster naturally                              |
| Multiple related providers sharing helpers             | Folder per provider + sibling `_shared/` folder         | Avoids leaking helpers into the top-level `providers/` namespace               |

### Cross-provider imports

Cross-provider imports go through the **subfolder barrel**, not into another provider's internals:

<!-- prettier-ignore -->
```typescript
// ✅ Good — imports through the subfolder barrel
import { TaskStoreProvider } from '../task-store';

// ❌ Bad — top-level barrel for sibling imports causes circular-init churn
import { TaskStoreProvider } from '..';
// ❌ Bad — reaches into another provider's implementation file
import { TaskStoreProvider } from '../task-store/task-store.provider';
```

Tool → provider imports follow the same rule:

```typescript
// ✅ Good — tool imports the provider's public surface from its barrel
import { TaskStoreProvider } from '../../providers/task-store';
```

### Same convention for tools and resources

The folder layout applies to `create-tool` and `create-resource` too. Once a tool grows a `<slug>.schema.ts` or a resource grows a content helper, promote it to `src/tools/<slug>/` or `src/resources/<slug>/` with the same barrel + spec layout. (Tracked separately in issue #405 for `create-tool`.)

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

The generator currently writes a single `<slug>.provider.ts` directly into `src/providers/`. Promote it to the folder layout above as soon as you add a spec file or helpers — see [File Layout](#file-layout).

## Verification

```bash
# Start server — providers initialize on startup
frontmcp dev

# Call a tool that uses the provider
# If provider fails to init, you'll see an error at startup
```

## Common Patterns

| Pattern               | Correct                                                                                           | Incorrect                                                               | Why                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Token definition      | `const DB: Token<DbService> = Symbol('DbService')` (typed Symbol)                                 | `const DB = 'database'` (string literal)                                | Typed `Token<T>` enables compile-time type checking on `this.get()`                          |
| DI resolution         | `this.get(TOKEN)` with error handling                                                             | `this.tryGet(TOKEN)!` with non-null assertion                           | `get` throws a clear `DependencyNotFoundError`; non-null assertions hide failures            |
| Lifecycle             | `AsyncProvider({ useFactory })` for async setup; constructor for sync                             | Using `onInit()` / `onDestroy()` lifecycle hooks                        | `@Provider` has no lifecycle hooks; `AsyncProvider` factories are awaited before resolution  |
| Registration scope    | Register at `@App` level for app-scoped, `@FrontMcp` for server-scoped                            | Registering same provider in multiple apps                              | Server-scoped providers are shared; duplicating causes multiple instances                    |
| Config provider       | `readonly` properties from `process.env`                                                          | Mutable properties that change at runtime                               | Providers are singletons; mutable state can cause race conditions                            |
| File layout           | `src/providers/<slug>/` folder with `index.ts` + `<slug>.provider.ts` + `<slug>.provider.spec.ts` | Flat `src/providers/<slug>.provider.ts` once helpers or a spec exist    | Co-locates source, tests, helpers; barrel hides internals — see [File Layout](#file-layout)  |
| Cross-provider import | `import { TaskStoreProvider } from '../task-store'` (subfolder barrel)                            | `import { TaskStoreProvider } from '../task-store/task-store.provider'` | Subfolder barrel hides internals; reaching past it couples consumers to implementation files |

## Verification Checklist

### Configuration

- [ ] Provider class has `@Provider` decorator with `name` (or factory uses `AsyncProvider`)
- [ ] Token is defined with `Token<T>` using a `Symbol` and typed interface
- [ ] Provider (class or `AsyncProvider` factory) is registered in `providers` array of `@App` or `@FrontMcp`
- [ ] Sync setup happens in the constructor (throws fast on missing config)
- [ ] Async setup uses `AsyncProvider({ useFactory })`; the framework awaits it before resolution
- [ ] Each provider lives in its own `src/providers/<slug>/` folder once it has a spec, helpers, or internal types (single-file is fine for trivial providers — see the [File Layout](#file-layout) rubric)

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
| [`config-and-api-providers`](../examples/create-provider/config-and-api-providers.md) | Intermediate | A configuration provider and an HTTP API client provider, organized as one folder per provider with co-located specs and barrels.             |

> See all examples in [`examples/create-provider/`](../examples/create-provider/)

## Reference

- [Providers Documentation](https://docs.agentfront.dev/frontmcp/extensibility/providers)
- Related skills: `create-tool`, `create-resource`, `create-agent`, `create-prompt`
