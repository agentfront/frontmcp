---
name: caching-with-around
reference: create-plugin-hooks
level: intermediate
description: 'Demonstrates wrapping tool execution with an `@Around` hook to implement result caching with TTL-based expiry.'
tags: [development, cache, plugin-hooks, plugin, hooks, caching]
features:
  - 'Using `@Around` to wrap the `execute` stage with before-and-after logic'
  - 'Calling `await next()` to invoke the original stage and capture its result'
  - 'Short-circuiting execution by returning cached data without calling `next()`'
  - 'Building a cache key from `ctx.toolName` and `ctx.input`'
---

# Caching Plugin with @Around Hook

Demonstrates wrapping tool execution with an `@Around` hook to implement result caching with TTL-based expiry.

## Code

```typescript
// src/plugins/cache.plugin.ts
import { Plugin } from '@frontmcp/sdk';
import { ToolHook } from '@frontmcp/sdk';

const { Around } = ToolHook;

@Plugin({ name: 'cache-plugin' })
export class CachePlugin {
  private cache = new Map<string, { data: unknown; expiry: number }>();

  @Around('execute', { priority: 90 })
  async cacheResults(ctx, next) {
    const key = `${ctx.toolName}:${JSON.stringify(ctx.input)}`;
    const cached = this.cache.get(key);

    if (cached && cached.expiry > Date.now()) {
      return cached.data;
    }

    const result = await next();

    this.cache.set(key, {
      data: result,
      expiry: Date.now() + 60_000,
    });

    return result;
  }
}
```

```typescript
// src/server.ts
import { FrontMcp, App } from '@frontmcp/sdk';
import { CachePlugin } from './plugins/cache.plugin';

@App({
  name: 'my-app',
  plugins: [CachePlugin],
})
class MyApp {}

@FrontMcp({
  info: { name: 'cached-server', version: '1.0.0' },
  apps: [MyApp],
})
class MyServer {}
```

## What This Demonstrates

- Using `@Around` to wrap the `execute` stage with before-and-after logic
- Calling `await next()` to invoke the original stage and capture its result
- Short-circuiting execution by returning cached data without calling `next()`
- Building a cache key from `ctx.toolName` and `ctx.input`

## Related

- See `create-plugin-hooks` for all hook decorator types and their timing
- See `official-plugins` for the production-ready `CachePlugin` from `@frontmcp/plugin-cache`
