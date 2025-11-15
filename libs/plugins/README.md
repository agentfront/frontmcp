# FrontMCP Plugins

Pluggable extensions for FrontMCP live here. Each plugin can contribute **providers**, **hooks**, and optional
**adapters** that extend the platform.

If you want to use a specific plugin, open that plugin’s README for full details. This page serves as an index and a
contributor guide.

---

## Table of contents

- [Available plugins](#available-plugins)
- [Quick start: enabling a plugin](#quick-start-enabling-a-plugin)
- [Contributor guide: authoring a plugin](#contributor-guide-authoring-a-plugin)
  - [1) Recommended folder layout](#1-recommended-folder-layout)
  - [2) Export surface (`index.ts`)](#2-export-surface-indexts)
  - [3) Extend tool metadata](#3-extend-tool-metadata)
  - [4) Implementing the plugin class](#4-implementing-the-plugin-class)
  - [5) Initialization styles (`DynamicPlugin.init`)](#5-initialization-styles-dynamicplugininit)
  - [6) Hooks contributed by plugins](#6-hooks-contributed-by-plugins)
  - [7) Registering your plugin in an app](#7-registering-your-plugin-in-an-app)
  - [8) Documentation checklist](#8-documentation-checklist)
  - [9) Hook families & roadmap](#9-hook-families--roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Available plugins

| Plugin | Description                                                                                                                 | Docs                                         | Path                       |
| ------ | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------- |
| Cache  | Transparent caching for tool outputs keyed by input. Supports in-memory and Redis stores; per-tool TTL and sliding windows. | [Cache Plugin README](./src/cache/README.md) | [`src/cache`](./src/cache) |

> For configuration and usage examples, follow the plugin’s own README.

---

## Quick start: enabling a plugin

```ts
// app.ts
import { App } from '@frontmcp/sdk';
import { CachePlugin } from '@frontmcp/plugins';

@App({
  id: 'my-app',
  name: 'My App',
  plugins: [
    CachePlugin, // or CachePlugin.init({...}) — see below for init styles
  ],
})
export default class MyApp {}
```

---

## Contributor guide: authoring a plugin

The sections below summarize structure, type augmentation, dynamic providers, and hooks.

### 1) Recommended folder layout

```
plugins/
  src/<your-plugin>/
    ├─ <your-plugin>.plugin.ts
    ├─ <your-plugin>.types.ts
    ├─ <your-plugin>.symbol.ts        # optional, for DI tokens
    ├─ providers/                     # optional, runtime providers
    │   └─ ...
    ├─ index.ts
    └─ README.md                      # user-facing docs
```

> If your repo uses a monorepo layout like `libs/plugins/src/...`, keep the same structure under that root. Paths in
> this README are relative to the current `plugins` folder.

### 2) Export surface (`index.ts`)

At `src/<your-plugin>/index.ts`, re-export the plugin and its types:

```ts
export { default } from './<your-plugin>.plugin';
export * from './<your-plugin>.types';
```

### 3) Extend tool metadata

If your plugin adds tool-level options (e.g., `cache`, `authorization`), augment the ambient
`ExtendFrontMcpToolMetadata` interface so tool authors get type-safe metadata.

```ts
// src/my-feature/my-feature.types.ts

declare global {
  interface ExtendFrontMcpToolMetadata {
    /** Enables MyFeature for a tool; `true` uses plugin defaults. */
    myFeature?: MyFeatureToolOptions | true;
  }
}

export interface MyFeatureToolOptions {
  level?: 'low' | 'medium' | 'high';
}

export interface MyFeaturePluginOptions {
  /** Options provided at plugin registration time. */
  defaultLevel?: 'low' | 'medium' | 'high';
}
```

> Why: `declare global` merges into the ambient tool metadata used by `@Tool` / `tool(...)`, so TypeScript validates
> options wherever tools are defined.

### 4) Implementing the plugin class

Plugins are classes decorated with `@Plugin(...)`. For plugins that need configuration and/or generated providers,
extend `DynamicPlugin<TOptions>` so you can support both value and factory initialization while contributing dynamic
providers.

```ts
// src/my-feature/my-feature.plugin.ts
import { Plugin, DynamicPlugin, FlowHooksOf, FlowCtxOf, ProviderType } from '@frontmcp/sdk';
import { MyFeaturePluginOptions } from './my-feature.types';

const ToolHook = FlowHooksOf('tools:call-tool');

@Plugin({
  name: 'plugin:my-feature',
  description: 'Does something useful',
  providers: [
    // Static providers that always load with the plugin (optional)
    // { provide: MyToken, useClass: MyProvider },
  ],
})
export default class MyFeaturePlugin extends DynamicPlugin<MyFeaturePluginOptions> {
  static defaultOptions: MyFeaturePluginOptions = {
    defaultLevel: 'medium',
  };

  // Contribute providers based on resolved options (runs before instance creation)
  static override dynamicProviders(options: MyFeaturePluginOptions): readonly ProviderType[] {
    const providers: ProviderType[] = [];
    // Decide implementations based on options
    // providers.push({ provide: MyToken, useValue: new MyProvider(options) });
    return providers;
  }

  constructor(public readonly options: MyFeaturePluginOptions = MyFeaturePlugin.defaultOptions) {
    super();
  }

  // Optional: register global tool hooks contributed by the plugin
  @ToolHook.Will('execute', { priority: 100 })
  async willExecute(ctx: FlowCtxOf<'tools:call-tool'>) {
    // Observe/mutate ctx.state.toolContext before tool execution
  }
}
```

### 5) Initialization styles (`DynamicPlugin.init`)

`DynamicPlugin` exposes a static `init()` so apps can register your plugin in different ways:

- **Raw class** — zero-arg constructor only; no dynamic providers from options:

  ```ts
  plugins: [MyFeaturePlugin];
  ```

- **Value style** — options known upfront; `dynamicProviders(options)` is evaluated and merged:

  ```ts
  plugins: [MyFeaturePlugin.init({ defaultLevel: 'high' })];
  ```

- **Factory style** — compute options from app DI; then merge `dynamicProviders(realOptions)`:

  ```ts
  plugins: [
    MyFeaturePlugin.init({
      inject: () => [SomeConfig],
      useFactory: (cfg) => ({ defaultLevel: cfg.level }),
    }),
  ];
  ```

Under the hood (high level):

- Static providers from `@Plugin({ providers: [...] })` are merged first.
- In **value**/**factory** styles, the registry evaluates `dynamicProviders(...)` and merges results.
- Provider tokens are de-duplicated to avoid conflicts.

> Implementation references (repository paths may vary): `libs/sdk/src/common/dynamic/dynamic.plugin.ts` and
> `libs/sdk/src/plugin/plugin.registry.ts`.

### 6) Hooks contributed by plugins

Plugins can register global hooks via `FlowHooksOf(...)`. The SDK exports helpers for the most common flows:

```ts
import { ToolHook, ListToolsHook, HttpHook } from '@frontmcp/sdk';

@ToolHook.Will('validateInput')
async ensureConstraints(ctx: FlowCtxOf<'tools:call-tool'>) {
  // ...
}
```

Available hook families today include:

- `ToolHook` (`tools:call-tool`) — observe or mutate tool execution.
- `ListToolsHook` (`tools:list-tools`) — filter/augment the tool catalog during discovery.
- `HttpHook` (`http:request`) — shape raw inbound HTTP requests before flow execution.

Within each family you can register `Will`, `Stage`, `Did`, or `Around` hooks. Use `FlowCtxOf<'flow-name'>` to access
typed context/state for that flow.

See the cache example hooks in: [`src/cache/cache.plugin.ts`](./src/cache/cache.plugin.ts).

### 7) Registering your plugin in an app

```ts
import { App } from '@frontmcp/sdk';
import { MyFeaturePlugin } from '@frontmcp/plugins';

@App({
  id: 'my-app',
  name: 'My App',
  plugins: [
    MyFeaturePlugin, // or MyFeaturePlugin.init({...})
  ],
})
export default class MyApp {}
```

### 8) Documentation checklist

Each plugin must ship a `README.md` that explains:

- **What it does** and **when to use it**
- **Installation & registration** examples (raw/value/factory)
- **Configuration options** (plugin-level and tool-level)
- **Providers** it contributes and any required external services
- **Hooks** it adds and how they affect tool/app behavior
- **Examples** (minimal and advanced)

For a concrete example, see the [Cache Plugin README](./src/cache/README.md).

### 9) Hook families & roadmap

The SDK currently exposes flow hooks for tools (`ToolHook`), tool discovery (`ListToolsHook`), and HTTP requests
(`HttpHook`). More flows (auth, transports, adapters) will land iteratively. Design plugins so you can adopt new hook
families by switching to `FlowHooksOf('<future-flow>')` as they ship.

---

## Contributing

1. Create your plugin under `src/<your-plugin>/` following the layout above.
2. Include a thorough `README.md` in your plugin folder.
3. Add your plugin to the **Available plugins** table (name, short description, links).
4. Submit a PR with tests and lint passing.

---

## License

This folder inherits the repository’s license unless otherwise noted in individual plugin folders.
