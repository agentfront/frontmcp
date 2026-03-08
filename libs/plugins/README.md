# @frontmcp/plugins

Official plugin collection for FrontMCP servers.

[![NPM](https://img.shields.io/npm/v/@frontmcp/plugins.svg)](https://www.npmjs.com/package/@frontmcp/plugins)

> **DEPRECATED**
>
> `@frontmcp/plugins` is an aggregator meta-package that will **no longer be published** from v1.0.0 onward.
> Please install individual plugin packages directly instead.
>
> | Instead of                                           | Use                                                          |
> | ---------------------------------------------------- | ------------------------------------------------------------ |
> | `npm install @frontmcp/plugins`                      | `npm install @frontmcp/plugin-cache` (etc.)                  |
> | `import { CachePlugin } from '@frontmcp/plugins'`    | `import { CachePlugin } from '@frontmcp/plugin-cache'`       |
> | `import { RememberPlugin } from '@frontmcp/plugins'` | `import { RememberPlugin } from '@frontmcp/plugin-remember'` |

## Install

```bash
npm install @frontmcp/plugins
```

Individual plugins are also available as standalone packages (`@frontmcp/plugin-cache`, etc.).

## Available Plugins

| Plugin        | Package                      | Description                                                                    | Docs                               |
| ------------- | ---------------------------- | ------------------------------------------------------------------------------ | ---------------------------------- |
| **Cache**     | `@frontmcp/plugin-cache`     | Transparent tool output caching with in-memory and Redis stores, per-tool TTL  | [Cache Plugin][docs-cache]         |
| **Remember**  | `@frontmcp/plugin-remember`  | Session memory — `this.remember.set/get`, scoped storage, tool approval system | [Remember Plugin][docs-remember]   |
| **CodeCall**  | `@frontmcp/plugin-codecall`  | Sandboxed code execution within tool flows                                     | [CodeCall Plugin][docs-codecall]   |
| **Dashboard** | `@frontmcp/plugin-dashboard` | Built-in admin dashboard for inspecting server state                           | [Dashboard Plugin][docs-dashboard] |

## Quick Start

```ts
import { App } from '@frontmcp/sdk';
import { CachePlugin, RememberPlugin } from '@frontmcp/plugins';

@App({
  id: 'my-app',
  name: 'My App',
  plugins: [
    CachePlugin, // zero-config
    RememberPlugin.init({ store: 'memory' }), // with options
  ],
})
export default class MyApp {}
```

Plugins support three registration styles:

- **Raw class** — `CachePlugin` (default options)
- **Value init** — `CachePlugin.init({ ttl: 60_000 })` (options known upfront)
- **Factory init** — `CachePlugin.init({ inject: () => [...], useFactory: (dep) => ({...}) })`

> Full plugin guide: [Plugins Overview][docs-overview]

## Creating Your Own Plugin

Extend `DynamicPlugin<Options>`, decorate with `@Plugin(...)`, and contribute providers, hooks, or context extensions.

> Step-by-step guide: [Creating Plugins][docs-creating]

## Related Packages

- [`@frontmcp/sdk`](../sdk) — core framework and `DynamicPlugin` base class
- [`@frontmcp/testing`](../testing) — E2E testing for plugin-contributed tools

## License

Apache-2.0 — see [LICENSE](../../LICENSE).

<!-- links -->

[docs-overview]: https://docs.agentfront.dev/frontmcp/plugins/overview
[docs-cache]: https://docs.agentfront.dev/frontmcp/plugins/cache
[docs-remember]: https://docs.agentfront.dev/frontmcp/plugins/remember
[docs-codecall]: https://docs.agentfront.dev/frontmcp/plugins/codecall
[docs-dashboard]: https://docs.agentfront.dev/frontmcp/plugins/dashboard
[docs-creating]: https://docs.agentfront.dev/frontmcp/plugins/creating-plugins
