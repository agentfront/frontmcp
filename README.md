# MCP Gateway

Build **Model Context Protocol (MCP)** servers with a strongly‑typed, extensible framework. MCP Gateway gives you first‑class primitives for **Tools**, **Plugins**, **Hooks**, **Providers**, and optional **Adapters**—so you can focus on product logic, not plumbing.

MIT‑licensed • Nx monorepo • TypeScript‑first

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#key-concepts">Key concepts</a> ·
  <a href="#using-plugins">Plugins</a> ·
  <a href="#project-layout">Project layout</a> ·
  <a href="#contributing-and-development">Contributing</a> ·
  <a href="#roadmap">Roadmap</a> ·
  <a href="#license">License</a>
</p>

---

## Overview

**MCP Gateway** is a batteries‑included runtime for building MCP servers. Define tools with decorators and **Zod** schemas, compose cross‑cutting concerns via **hook stages**, and extend behavior with a simple yet powerful **plugin system**. The repo is organized as an **Nx** workspace with multiple libraries under `libs` and example applications under `apps`.

---

## Features

* **Tool‑centric DX**

  * Define tools with `@McpTool`, Zod input/output schemas, and a single async `execute`.
  * Hook stages let you parse/validate input, authorize, collect metrics, and redact output.
* **Extensible plugins**

  * Plugins can contribute dynamic providers and global tool hooks.
  * Configure plugins with static options or DI‑powered factories (`inject` + `useFactory`).
* **Dependency Injection (DI)**

  * Lightweight provider registry with tokens and scopes (global/session/request).
  * Dynamic providers resolved early in the app lifecycle.
* **TypeScript‑first**

  * Strong typing for tool metadata via global declaration merging.
* **Ready‑to‑use Cache plugin**

  * Per‑tool opt‑in caching with TTL & sliding window semantics.
  * Memory and Redis stores supported.

---

## Quick start

### Prerequisites

* Node.js **>= 20**
* **Yarn** (the workspace uses Yarn; pnpm/npm can work, examples assume Yarn)

### Install

```bash
yarn install
```

### Build core libraries

```bash
yarn nx build common
yarn nx build core
yarn nx build plugins
```

### Run the example Expenses MCP app (watch mode)

```bash
yarn nx serve expenses
```

The example lives at `apps/expenses` and demonstrates tool definitions and plugin usage (Cache).

> **Tip:** `yarn nx graph` to explore project dependency graphs.

---

## Key concepts

### App

Decorate a class with `@McpApp({ name, providers, adapters?, plugins, tools })` to define your server entry.

```ts
import { McpApp } from '@frontmcp/sdk';
import CachePlugin from '@frontmcp/plugins/cache';
import CreateExpense from './tools/create-expense.tool';

@McpApp({
  name: 'expense-mcp',
  plugins: [CachePlugin],
  tools: [CreateExpense],
  // providers: [...],
  // adapters: [...],
})
export default class ExpenseMcp {}
```

### Tools

A class annotated with `@McpTool({ name, description, inputSchema, outputSchema, ... })` and an async `execute(input, ctx)`.

Hooks can participate in the tool lifecycle: `@WillParseInput`, `@WillValidateInput`, `@CanActivate`, `@WillRedactOutput`, `@OnMetrics`, `@AroundExecute`.

```ts
import z from 'zod';
import { McpTool, ToolInvokeContext } from '@frontmcp/sdk';

const inputSchema = { id: z.string().min(1) };
const outputSchema = { ok: z.string() };

type In = z.baseObjectInputType<typeof inputSchema>;
type Out = z.baseObjectOutputType<typeof outputSchema>;

@McpTool({ name: 'hello', description: 'Example tool', inputSchema, outputSchema })
export default class HelloTool {
  async execute(input: In, _ctx: ToolInvokeContext<In, Out>): Promise<Out> {
    return { ok: `Hello ${input.id}` };
  }
}
```

### Providers (DI)

Register tokens and concrete providers; resolve them in `ctx.get(Token)` from within tools and hooks. Providers can be **global**, **session**, or **request** scoped.

```ts
import { McpProvider, Scope } from '@frontmcp/sdk';

@McpProvider({ name: 'config', scope: Scope.GLOBAL })
export class ConfigProvider {
  get(key: string) { /* read from env/files */ }
}
```

### Plugins

Extend `DynamicPlugin<TOptions>` and decorate with `@McpPlugin` to contribute providers/adapters/tools and global tool hooks. Initialize with a value via `init({ ... })` or factory via `init({ inject, useFactory })`.

```ts
import CachePlugin from '@frontmcp/plugins/cache';

@McpApp({
  name: 'my-app',
  plugins: [
    CachePlugin,
    // or customize:
    // CachePlugin.init({ defaultTTL: 300 })
    // or factory style with DI:
    // CachePlugin.init({
    //   inject: () => [ConfigProvider],
    //   useFactory: (cfg: ConfigProvider) => ({ defaultTTL: cfg.get('cache.ttl') })
    // })
  ],
  tools: [/* your tools */],
})
export class MyApp {}
```

### Hooks (tool lifecycle)

Global tool hooks are contributed by plugins using `@ToolHook(ToolHookStage.someStage)`. Per‑tool hooks use the decorators listed above.

```ts
import { ToolHook, ToolHookStage } from '@frontmcp/sdk';

@ToolHook(ToolHookStage.CanActivate)
export class RequireAuthHook {
  async run(ctx) {
    const user = await ctx.get(AuthProvider).currentUser();
    if (!user) throw new Error('Unauthorized');
  }
}
```

### Adapters (optional)

Adapters allow integration points to external runtimes/transports (e.g., HTTP, CLI, custom bridges). Apps and plugins can contribute adapters and participate in adapter initialization via future adapter hooks.

---

## Using plugins

See the plugins index for a catalog and contributor guidance:

* Plugins index: `./libs/plugins/README.md`
* Cache plugin docs: `./libs/plugins/src/cache/README.md`

**Per‑tool opt‑in caching** (default memory store, 1‑day TTL unless overridden):

```ts
@McpTool({
  name: 'get-expense-by-id',
  inputSchema,
  outputSchema,
  cache: { ttl: 60, slideWindow: true },
})
```

**Redis‑backed caching** (configure via plugin options or DI factory):

```ts
CachePlugin.init({
  store: 'redis',
  redis: { host: '127.0.0.1', port: 6379 },
  defaultTTL: 300,
});
```

---

## Project layout

```
apps/
  expenses/            # Example MCP app
libs/
  common/              # Shared types, decorators, plugin base (DynamicPlugin)
  core/                # Runtime: registries, metadata utils, execution pipeline
  plugins/             # First‑party plugins (e.g., Cache)
```

---

## Contributing and Development

We welcome issues and PRs! To work locally:

### Build & run

```bash
yarn install
yarn nx build common core plugins
yarn nx serve expenses
```

### Test, lint, format

```bash
yarn nx test [project]
yarn nx lint [project]
yarn nx format:check
```

### Coding standards

* TypeScript, strict typing favored
* Keep public APIs minimal and documented
* Prefer small, composable hooks and providers
* Update or add docs (e.g., plugin READMEs) with behavior changes

### PR guidelines

* Keep PRs focused and include a clear rationale
* Add tests where practical
* Document new hooks/providers/plugins

---

## Roadmap

The hook surface is evolving. Planned families:

* **AppHook**: bootstrap/shutdown lifecycle
* **HttpHook**: inbound/outbound request observation & mutation
* **AuthHook**: authentication/authorization lifecycle
* **AdapterHooks**: adapter initialization/configuration
* **IO hooks**: monitor and optionally block filesystem/native calls

(Placeholders may exist to help authors prepare for future capabilities.)

---

## FAQ

**Is this MCP‑spec compliant?**  MCP Gateway is a framework to build MCP servers. Adapters can expose your tools over your chosen transport; see examples and plugins for guidance.

**Do I have to use Yarn?**  No, but the workspace is configured for Yarn and the docs assume it.

**Can I bring my own cache store?**  Yes—implement a plugin or extend the Cache plugin with a compatible store.

---

## License

MIT © MCP Gateway contributors
