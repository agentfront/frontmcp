# @frontmcp/plugins

A meta-package that installs four official FrontMCP plugins and re-exports everything they export:
[`@frontmcp/plugin-cache`](https://www.npmjs.com/package/@frontmcp/plugin-cache),
[`@frontmcp/plugin-codecall`](https://www.npmjs.com/package/@frontmcp/plugin-codecall),
[`@frontmcp/plugin-dashboard`](https://www.npmjs.com/package/@frontmcp/plugin-dashboard) and
[`@frontmcp/plugin-remember`](https://www.npmjs.com/package/@frontmcp/plugin-remember). It has no code of its own.
We recommend installing the plugin packages you use instead: you get only what you need, and the other official
plugins (approval, feature flags, Skilled OpenAPI, WebMCP) are only published on their own.

[![npm](https://img.shields.io/npm/v/@frontmcp/plugins.svg)](https://www.npmjs.com/package/@frontmcp/plugins) [![License](https://img.shields.io/npm/l/@frontmcp/plugins.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

```bash
npm install @frontmcp/plugins @frontmcp/sdk
```

Or, as recommended, only the plugins you use:

```bash
npm install @frontmcp/plugin-cache @frontmcp/plugin-remember @frontmcp/sdk
```

Requires Node.js 24 or later. Each plugin depends on exactly its own version of `@frontmcp/sdk`, so
keep every `@frontmcp/*` package in your app on the same version.

## Usage

Import a plugin from `@frontmcp/plugins` and list `SomePlugin.init({ ... })` in the `plugins` of an `@App`, for that
app's tools, or of `@FrontMcp`, for every app's:

```ts
import { CachePlugin, RememberPlugin } from '@frontmcp/plugins';
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'get_product',
  description: 'A product by SKU',
  inputSchema: { sku: z.string() },
  cache: { ttl: 600 }, // a field the cache plugin adds to @Tool
})
class GetProduct extends ToolContext {
  async execute({ sku }: { sku: string }) {
    return { sku, name: 'Mechanical keyboard' };
  }
}

@App({
  id: 'catalog',
  name: 'Catalog',
  tools: [GetProduct],
  plugins: [CachePlugin.init({ type: 'memory' })],
})
class CatalogApp {}

@FrontMcp({
  info: { name: 'shop', version: '1.0.0' },
  apps: [CatalogApp],
  plugins: [RememberPlugin.init({ type: 'memory' })], // this.remember, for every app's tools
})
export default class Server {}
```

`CachePlugin` from `@frontmcp/plugins` is the same class as `CachePlugin` from `@frontmcp/plugin-cache`, and the
same goes for the others, so moving to the individual packages only changes the import path. Pick one import path
and use it everywhere.

## What it includes

| Plugin    | Main exports                      | What it does                                                                                                               | Docs                                                                  |
| --------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Cache     | `CachePlugin`                     | Answers repeated tool calls from a store (memory, Redis or Vercel KV) instead of running the tool again. Tools opt in.     | [Cache](https://frontmcp.dev/reference/plugins/cache)                 |
| CodeCall  | `CodeCallPlugin`                  | Puts many tools behind a few `codecall:*` meta-tools: the model searches your tools and runs short scripts that call them. | [CodeCall](https://frontmcp.dev/reference/plugins/codecall)           |
| Dashboard | `DashboardPlugin`, `DashboardApp` | A web page and an MCP endpoint at `/dashboard` that show the server's apps, tools, resources and prompts.                  | [The dashboard](https://frontmcp.dev/reference/plugins#the-dashboard) |
| Remember  | `RememberPlugin`                  | `this.remember`, an encrypted key-value memory for tools, kept per session, user or tool, or shared by everyone.           | [Remember](https://frontmcp.dev/reference/plugins/remember)           |

Every other export of those packages (types, errors, tokens, and helpers like `getRemember`) is re-exported too.
Not included: [`@frontmcp/plugin-approval`](https://www.npmjs.com/package/@frontmcp/plugin-approval),
[`@frontmcp/plugin-feature-flags`](https://www.npmjs.com/package/@frontmcp/plugin-feature-flags),
[`@frontmcp/plugin-skilled-openapi`](https://www.npmjs.com/package/@frontmcp/plugin-skilled-openapi),
[`@frontmcp/plugin-webmcp`](https://www.npmjs.com/package/@frontmcp/plugin-webmcp) and
[`@frontmcp/adapters`](https://www.npmjs.com/package/@frontmcp/adapters). Install those on their own.

## Docs

- [Plugins and adapters](https://frontmcp.dev/reference/plugins): every official plugin, which package it's in, and
  where to register it
- [Built-in Plugins and Adapters](https://frontmcp.dev/learn/built-in-plugins-and-adapters): one lesson per plugin
- [Extending with Plugins](https://frontmcp.dev/learn/extending-with-plugins): writing a plugin of your own
- [`@Plugin` reference](https://frontmcp.dev/reference/sdk/plugin)

## Related packages

- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk): the framework these plugins extend, with `@App`,
  `@FrontMcp`, `@Plugin` and `DynamicPlugin`
- [`@frontmcp/testing`](https://www.npmjs.com/package/@frontmcp/testing): end-to-end tests for servers that use
  these plugins

## Contributing

Source: [`libs/plugins`](https://github.com/agentfront/frontmcp/tree/main/libs/plugins). Each plugin's code is under
[`plugins/`](https://github.com/agentfront/frontmcp/tree/main/plugins). Issues and pull requests are welcome; see
[CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
