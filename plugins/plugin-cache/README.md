# @frontmcp/plugin-cache

A FrontMCP plugin that stores what a tool returns and answers the next call with the same arguments from the store,
without running the tool again. Use it for tools that are slow or costly and whose answer doesn't change every
call. Tools opt in one by one, with `cache` in `@Tool`, or by name, with `toolPatterns`. Entries live in memory, in
Redis, or in Vercel KV, and each entry belongs to the caller who made it unless you say otherwise.

[![npm](https://img.shields.io/npm/v/@frontmcp/plugin-cache.svg)](https://www.npmjs.com/package/@frontmcp/plugin-cache) [![License](https://img.shields.io/npm/l/@frontmcp/plugin-cache.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

```bash
npm install @frontmcp/plugin-cache @frontmcp/sdk
```

Requires Node.js 24 or later. Keep `@frontmcp/sdk` on the same version as this package. The Redis
client (`ioredis`) is included. `@vercel/kv` is an optional peer dependency: install it to use Vercel KV through
`type: 'global-store'`.

## Usage

Register the plugin on the app whose tools it should cache, and mark those tools with `cache`:

```ts
import { CachePlugin } from '@frontmcp/plugin-cache';
import { App, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'get_exchange_rate',
  description: 'The current exchange rate between two currencies',
  inputSchema: { from: z.string().length(3), to: z.string().length(3) },
  cache: { ttl: 300 }, // answer repeated calls from the cache for 5 minutes
})
export class GetExchangeRate extends ToolContext {
  async execute({ from, to }: { from: string; to: string }) {
    return { from, to, rate: await lookUpRate(from, to) };
  }
}

@App({
  id: 'rates',
  name: 'Rates',
  tools: [GetExchangeRate],
  plugins: [CachePlugin.init({ type: 'memory', keyByIdentity: false })], // the same rate for every caller
})
export class RatesApp {}
```

A cached answer skips `execute()`, and its result carries `_meta.cache: 'hit'`. `CachePlugin.init()` with no
argument, and `plugins: [CachePlugin]`, mean `type: 'memory'` with the defaults. On `@FrontMcp({ plugins })`, the
plugin caches every app's tools.

## `cache` on `@Tool`

A tool is cached when it has `cache`, or its name matches `toolPatterns`. Nothing else is cached.

| Value                                   | An entry lives | Reading the entry                                          |
| --------------------------------------- | -------------- | ---------------------------------------------------------- |
| `cache: true`                           | `defaultTTL`   | Leaves its expiry as it was                                |
| `cache: { ttl: 60 }`                    | 60 seconds     | Leaves its expiry as it was                                |
| `cache: { ttl: 60, slideWindow: true }` | 60 seconds     | Gives it a full 60 seconds again                           |
| `cache: { ttl: 0 }`, or a negative TTL  | Not stored     | The tool isn't cached, even when `toolPatterns` matches it |

The key is a SHA-256 hash of the caller (see below), the tool (`<app id>:<tool name>`), and the validated arguments
with object keys sorted. A result the tool returns with `isError: true` isn't stored.

## Who gets which entry

With `keyByIdentity: true`, the default, each caller gets their own entries: a signed-in user is keyed by their token's
subject, so one user never gets another user's cached answer.

- **Without authentication, MCP 2026-07-28 clients never get a cached answer.** FrontMCP gives an anonymous caller a
  new identity on every request, so the plugin stores an entry on every call and never reads one back. There's no
  error or warning.
- **For tools whose answer is the same for everyone** (exchange rates, a public catalog), set
  `keyByIdentity: false`. Every caller then shares one entry per tool and arguments, so never use it for tools whose
  answer depends on the caller's account, tenant or permissions.

## Options

| Option          | Default                      | Description                                                                                                                                                                  |
| --------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`          | `'memory'`                   | Where entries are kept: `'memory'`, `'redis'`, `'redis-client'` or `'global-store'`. Required when you pass options.                                                         |
| `defaultTTL`    | `86400` (a day)              | Seconds an entry lives when the tool's `cache` gives no `ttl`, and for tools matched by `toolPatterns`.                                                                      |
| `keyByIdentity` | `true`                       | Keep separate entries per caller. See [Who gets which entry](#who-gets-which-entry).                                                                                         |
| `toolPatterns`  | `[]`                         | Cache these tools too, without `cache` in their metadata. A tool name or `<app id>:<tool name>`, where `*` matches anything: `'catalog:*'`, `'get_*'`.                       |
| `bypassHeader`  | `'x-frontmcp-disable-cache'` | A request header that skips the cache for that call when its value is `true` or `1`. It must start with `x-frontmcp-`, or `init()` throws a `CachePluginConfigurationError`. |
| `config`        |                              | With `type: 'redis'`: `{ host, port, password?, db? }`.                                                                                                                      |
| `client`        |                              | With `type: 'redis-client'`: an `ioredis` client you created.                                                                                                                |

## Stores

`'memory'` keeps entries in the server's process: they're lost on restart and aren't shared between instances. For
Redis, let the plugin connect:

```ts
CachePlugin.init({
  type: 'redis',
  defaultTTL: 300,
  config: { host: 'localhost', port: 6379, password: process.env.REDIS_PASSWORD, db: 0 },
});
```

Or pass a client you already have:

```ts
import { Redis } from 'ioredis';

const redis = new Redis({ host: 'localhost', port: 6379 });

CachePlugin.init({ type: 'redis-client', client: redis, defaultTTL: 300 });
```

`'global-store'` uses the store configured on `@FrontMcp({ redis })`: Redis, or Vercel KV with
`redis: { provider: 'vercel-kv' }` (which reads `KV_REST_API_URL` and `KV_REST_API_TOKEN` when you don't pass `url`
and `token`). Without `redis`, the server doesn't start.

```ts
@App({ id: 'catalog', name: 'Catalog', plugins: [CachePlugin.init({ type: 'global-store' })] })
class CatalogApp {}

@FrontMcp({
  info: { name: 'shop', version: '1.0.0' },
  apps: [CatalogApp],
  redis: { host: 'localhost', port: 6379 },
})
export default class Server {}
```

## Docs

- [Cache plugin reference](https://frontmcp.dev/reference/plugins/cache): every option, the key, hits, bypassing and
  troubleshooting, with runnable examples
- [Caching Results](https://frontmcp.dev/learn/caching-results): a step-by-step lesson
- [Plugins and adapters](https://frontmcp.dev/reference/plugins): where to register a plugin

## Related packages

- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk): the framework this plugin extends
- [`@frontmcp/plugin-remember`](https://www.npmjs.com/package/@frontmcp/plugin-remember): `this.remember`, for values
  your tools store and read themselves
- [`@frontmcp/plugin-codecall`](https://www.npmjs.com/package/@frontmcp/plugin-codecall): depends on this plugin
- [`@frontmcp/plugins`](https://www.npmjs.com/package/@frontmcp/plugins): a meta-package that re-exports this plugin
  with three others

## Contributing

Source: [`plugins/plugin-cache`](https://github.com/agentfront/frontmcp/tree/main/plugins/plugin-cache). Issues and
pull requests are welcome; see [CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
