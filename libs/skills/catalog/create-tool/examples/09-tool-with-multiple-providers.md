---
name: 09-tool-with-multiple-providers
level: intermediate
description: 'Tool composing three DI services — config (env-only), cache (optional, `tryGet`), and database (required) — the realistic shape for a production tool.'
tags: [di, multiple-providers, cache-aside, tryGet]
features:
  - 'Resolving multiple providers via `this.get(TOKEN)` and `this.tryGet(TOKEN)`'
  - 'Cache-aside pattern — check `tryGet(CACHE)` first, fall back to the database'
  - 'Reading typed config from a `CONFIG` token vs `process.env` directly'
  - Letting the tool work in production (with cache) AND in test (without it)
---

# Tool With Multiple Providers

Tool composing three DI services — config (env-only), cache (optional, `tryGet`), and database (required) — the realistic shape for a production tool.

Production tools usually compose several services: config + cache + database is the standard trio. This example wires all three.

## Code

```typescript
// src/apps/main/tokens.ts
import type { Token } from '@frontmcp/di';

export interface AppConfig {
  weatherApiKey: string;
  cacheTtlSeconds: number;
}
export interface CacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}
export interface WeatherRepo {
  loadFromDb(city: string): Promise<{ temperatureF: number; conditions: string } | null>;
}

export const CONFIG: Token<AppConfig> = Symbol('AppConfig');
export const CACHE: Token<CacheService> = Symbol('CacheService');
export const WEATHER_REPO: Token<WeatherRepo> = Symbol('WeatherRepo');
```

```typescript
// src/apps/main/tools/get-weather.tool.ts
import { ResourceNotFoundError, Tool, ToolContext, z } from '@frontmcp/sdk';

import { CACHE, CONFIG, WEATHER_REPO } from '../tokens';

const inputSchema = { city: z.string().describe('City name') };
const outputSchema = {
  city: z.string(),
  temperatureF: z.number(),
  conditions: z.string(),
  cached: z.boolean(),
};

@Tool({
  name: 'get_weather',
  description: 'Current weather — cache-aside, falls back to the DB',
  inputSchema,
  outputSchema,
})
export class GetWeatherTool extends ToolContext {
  async execute(input: { city: string }) {
    const config = this.get(CONFIG); // required — throws if missing
    const cache = this.tryGet(CACHE); // optional — production has it, tests skip it
    const repo = this.get(WEATHER_REPO); // required

    const cacheKey = `weather:${input.city.toLowerCase()}`;

    if (cache) {
      const cached = await cache.get<{ temperatureF: number; conditions: string }>(cacheKey);
      if (cached) {
        return { city: input.city, ...cached, cached: true };
      }
    }

    const fresh = await repo.loadFromDb(input.city);
    if (!fresh) {
      this.fail(new ResourceNotFoundError(`weather:${input.city}`));
    }

    if (cache) {
      await cache.set(cacheKey, fresh, config.cacheTtlSeconds);
    }

    return { city: input.city, ...fresh, cached: false };
  }
}
```

## What This Demonstrates

- Resolving multiple providers via `this.get(TOKEN)` and `this.tryGet(TOKEN)`
- Cache-aside pattern — check `tryGet(CACHE)` first, fall back to the database
- Reading typed config from a `CONFIG` token vs `process.env` directly
- Letting the tool work in production (with cache) AND in test (without it)

## Why `tryGet` for cache

- In production: the app registers a Redis-backed cache provider. `this.tryGet(CACHE)` returns it.
- In tests: tests skip registering the cache. `tryGet(CACHE)` returns `undefined`. The tool falls through to the DB. No special test setup required.

## Why `this.get(CONFIG)` instead of `process.env.WEATHER_API_KEY`

- Config goes through a typed provider — tests inject a mock `{ weatherApiKey: 'test', cacheTtlSeconds: 0 }` without touching `process.env`.
- The shape is enforced by TypeScript; renaming a config field is a compile-time error across all callers.
- Multiple apps on the same server can have different config provider implementations.
