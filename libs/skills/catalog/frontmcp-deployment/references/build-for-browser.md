---
name: build-for-browser
description: Build a FrontMCP server or client for browser environments and frontend frameworks
---

# Building for Browser

Build your FrontMCP server or client for browser environments.

## When to Use This Skill

### Must Use

- Building a browser-compatible MCP client or tool interface for a web application
- Embedding MCP tools in a React, Vue, or other frontend framework using `@frontmcp/react`
- Creating a client-side bundle that connects to a remote MCP server

### Recommended

- Prototyping MCP tool UIs in the browser before building a full backend
- Shipping a web-based admin dashboard that lists and invokes MCP tools
- Building a PWA or single-page app that consumes MCP resources

### Skip When

- Running MCP tools on a Node.js server -- use `--target node` or `build-for-cli`
- Embedding MCP in an existing Node.js app without HTTP -- use `build-for-sdk`
- Deploying to Cloudflare Workers or other edge runtimes -- use `deploy-to-cloudflare`

> **Decision:** Choose this skill when the MCP consumer runs in a browser; use server-side build targets for Node.js environments.

## Build Command

```bash
frontmcp build --target browser
```

### Options

```bash
frontmcp build --target browser -o ./dist/browser   # Custom output directory
frontmcp build --target browser -e ./src/client.ts   # Custom entry file
```

## Browser Limitations

Not all FrontMCP features are available in browser environments:

| Feature                     | Browser Support | Notes                                                                  |
| --------------------------- | --------------- | ---------------------------------------------------------------------- |
| Tools (client-side)         | Yes             | Can define and run tools                                               |
| Resources                   | Yes             | Read-only access                                                       |
| Prompts                     | Yes             | Full support                                                           |
| Redis                       | No              | Use in-memory or connect to server                                     |
| SQLite                      | No              | No filesystem access                                                   |
| File system utilities       | No              | `@frontmcp/utils` fs ops throw in browser                              |
| Crypto (`@frontmcp/utils`)  | Yes             | Uses WebCrypto API                                                     |
| Direct client (`connect()`) | Yes             | In-memory connection                                                   |
| `ConfigPlugin`              | Yes             | No `.env` / `config.yml` files: schema defaults and `process.env` only |
| Shared server, Unix socket  | No              | `runShared()` and `runUnixSocket()` reject in a page                   |

A store never picks Redis or SQLite on its own in a page. When the config would give one to a store, `create()` fails at startup, before any store opens, with one `BrowserStoreUnavailableError` (`BROWSER_STORE_UNAVAILABLE`) that names every such store and its switch:

| Store                                                   | Refused when                                                                | Switch                                               |
| ------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------- |
| Background tasks                                        | `tasks.redis`, `tasks.sqlite`, or the top-level `redis`/`sqlite` they take  | `tasks.store: false`                                 |
| Elicitation                                             | `elicitation.redis`, or the top-level `redis`/`sqlite`                      | `elicitation.store: false`                           |
| Persistent questions                                    | their storage, the `redis`/`sqlite` they take, or their default SQLite file | `elicitation.persistent.storage: { type: 'memory' }` |
| Jobs                                                    | `jobs.store.redis`/`sqlite`, or the top-level `redis`/`sqlite`              | `jobs.store: false`                                  |
| Rate limits                                             | `throttle.storage: { type: 'redis' }` or `{ type: 'sqlite' }`               | `throttle.storage: { type: 'memory' }`               |
| Auth tokens                                             | `auth.tokenStorage: { redis }` or `{ sqlite }`                              | `auth.tokenStorage: 'memory'`                        |
| Skills HTTP cache                                       | `skillsConfig.cache.redis` with `provider: 'redis'`                         | leave `skillsConfig.cache.redis` out                 |
| A plugin's store (`CachePlugin`, `ApprovalPlugin`, ...) | the plugin's Redis or SQLite option                                         | the plugin's memory option                           |

With the switches set, the top-level `redis` and `sqlite` may stay in the config: those stores keep their state in memory (on Node too), and the page opens neither. Vercel KV, Upstash and Cloudflare KV, reached over HTTPS, are allowed. Up to 1.10 a task, elicitation or job store on Redis fell back to memory with a console warning (the Redis client cannot load in a page), a store on SQLite, or persistent questions, failed startup with a module or store error, the rate-limit, auth-token and skills-cache stores failed with the storage layer's errors (or fell back to memory), and startup refused the SDK's stores first: a plugin's store was named only once those were switched off.

Two stores are refused where they open, with the same error: a resource store (`resourceStore({ storage: { type: 'redis' } })` or `'sqlite'`) when it connects, which for one a resource serves (`@Resource({ from })`) is at startup, naming `storage: { type: 'memory' }`; and `sqliteStorageProvider()` when its provider is built at boot (inside the provider's `ProviderConstructionError`, as `originalError`).

The official plugins name theirs and their memory option: `CachePlugin` and `RememberPlugin` on `type: 'redis'` or `'redis-client'`, or on `'global-store'` with a Redis `redis`, name `type: 'memory'`; `ApprovalPlugin` and `ResultHandlesPlugin` on `storage: { type: 'redis' }` or `{ type: 'sqlite' }` name `storage: { type: 'memory' }`. `init()` no longer throws for them in a page, and on Node a `type: 'redis'` cache or remember store connects when the first server that installs it starts rather than when `init()` runs, and the servers that share one `init()` share its client. Up to 1.10 the cache and remember plugins opened the Redis client anyway and failed on first use, and the approval and result-handles plugins fell back to memory with a warning or, in production, failed with a connection or module error. A plugin of your own declares its stores with `static browserStores` (see [`create-plugin`](../../frontmcp-development/references/create-plugin.md#a-store-a-browser-cannot-open)).

`CachePlugin` and `RememberPlugin` load `ioredis` when they build a Redis store, so a page that uses them on memory or Vercel KV does not bundle it (up to 1.10 it did, in the page's first chunk).

> **A REST token in a page is public.** Upstash (`UPSTASH_REDIS_REST_TOKEN`) and Vercel KV (`KV_REST_API_TOKEN`, or `redis: { provider: 'vercel-kv', token }`) are reached over HTTPS, so a page can use them, but the token goes into the bundle, where every visitor can read it and use it on the whole database. Use them from a page only with a token scoped to what every visitor may do (Upstash's read-only token, for example), or keep the store behind your own server.

In a page the server logs at `warn` unless `logging.level` is set, and it never prints the "No distributed storage backend detected in production" warning (a browser bundle has `NODE_ENV=production`, but there is no Redis to configure), nor the "requestState is signed with a per-process key" warning (a page is one instance). Up to 1.9.4 it logged about 20 INFO lines while starting, an INFO block on every tool call, and that warning once per scope.

### NODE_ENV in the browser

`runtimeContext.env`, `isProduction()` / `isDevelopment()` and error formatting all read one value:
a `process` shim's `NODE_ENV` (`globalThis.process.env.NODE_ENV`) first, then the value the bundler
inlines for `process.env.NODE_ENV`. With neither, `env` is `development` while `isDevelopment()` stays
`false`, as on Node, and errors keep
their message. Set `NODE_ENV=production` for production errors (an error ID, no stack) and to hide
`/readyz` probe details. Up to 1.9.1 the browser build reported `env: 'production'` while formatting
errors for development.

### Request context in the browser

A browser has no `AsyncLocalStorage`. Unless the runtime provides TC39 `AsyncContext`
(`getAsyncContextMode()` from `@frontmcp/utils` is then `'native'`), the browser build runs
requests one at a time (`'serialized'`) so a request never reads another request's session, auth
info or running tool:

- `DirectMcpServer` calls, `connect()` clients and `createFetchHandler` requests take turns. A
  request keeps its turn until it returns and everything it started has unwound; background jobs,
  workflows and tasks take their own turn afterwards.
- A request waiting on its client (elicitation, `roots/list`) steps aside while it waits.
- Concurrent tool calls inside one request (`Promise.all`) are refused with
  `AsyncContextOverlapError` once they overlap. Run them one after another.
- A workflow runs its ready steps one at a time, whatever its `maxConcurrency`, so each step runs
  once instead of overlapping and being retried.
- A tool must not call its own server through a `DirectClient`/`DirectMcpServer` (it waits for its
  own turn); use `this.scope` flows. A request that waits more than 10s for its turn logs why.
- Timers and un-awaited promises must not read request context.

## Usage with @frontmcp/react

The browser build is commonly paired with `@frontmcp/react` for React applications. `FrontMcpProvider` takes a pre-created `DirectMcpServer` (via the SDK's `create()` factory) — not a `serverUrl`. Hooks for listing/invoking are `useListTools` / `useCallTool`:

```typescript
import { create } from '@frontmcp/sdk';
import { FrontMcpProvider, useListTools, useCallTool } from '@frontmcp/react';

// Create the server once (outside React) and pass the instance to the provider.
const server = await create({
  info: { name: 'browser-app', version: '1.0.0' },
  // tools/resources/prompts as flat config (see build-for-sdk)
  tools: [/* ... */],
});

function App() {
  return (
    <FrontMcpProvider server={server}>
      <ToolUI />
    </FrontMcpProvider>
  );
}

function ToolUI() {
  // useListTools returns ToolInfo[] directly (live-updates from the provider's registry).
  const tools = useListTools();
  // useCallTool returns [callFn, state, reset]. Pass the tool name to the hook,
  // and call the returned function with just the arguments object.
  const [callGetWeather, weatherState] = useCallTool('get_weather');
  return (
    <ul>
      {tools.map((t) => (
        <li key={t.name}>
          <button onClick={() => callGetWeather({})}>{t.name}</button>
        </li>
      ))}
    </ul>
  );
}
```

Things that trip people up with `@frontmcp/react`:

- A plain Vite app (7 or 8, build and dev server) bundles `@frontmcp/sdk` + `@frontmcp/react` from npm with no Node polyfills, no `process` define and no `express` alias: the bundler resolves the SDK's `browser` export condition to its browser build, for an `import` and for a CommonJS `require()` alike. Don't add `vite-plugin-node-polyfills` for FrontMCP.
- The browser builds of `@frontmcp/sdk`, `@frontmcp/utils` and `@frontmcp/auth` are one ES module per source file, so the bundler keeps only the modules the page reaches, and puts the server `create()` starts, and each feature the config turns on (agents, skills, tool UI, elicitation, jobs, channels, ...), in chunks of their own. Server-only code (the stdio bridge, process supervision, people sign-in, the auth pages, the Redis session stores) stays out of the page. Vite and webpack split them by default; an esbuild build needs `splitting: true` with `format: 'esm'`, or it inlines them all into one file.
- A browser Web Worker gets the same browser builds as a page. webpack's `target: 'webworker'` and Parcel's workers resolve the `worker` and `browser` conditions, Vite resolves `browser` for a worker as for a page, and a worker entry in a webpack page build (`new Worker(new URL('./worker.js', import.meta.url))`) resolves its imports like the page. With Rollup, pass `browser: true` to `@rollup/plugin-node-resolve` (without it Rollup resolves the Node builds); with esbuild, use `platform: 'browser'`. Up to 1.10, `@frontmcp/utils` and `@frontmcp/protocol` gave the `worker` condition their Node builds, so a `target: 'webworker'` bundle failed with `process is not defined` or a missing Node built-in. The Node builds now go to `workerd` (Cloudflare), see `deploy-to-cloudflare`.
- `@frontmcp/sdk`'s `dist/browser/index.cjs` is the browser build a `require()` gets without the `module` condition (jest-environment-jsdom, for example). It requires `@frontmcp/storage-sqlite` on first use instead of bundling it (up to 1.10 it bundled it, with its `node:events` imports). It keeps `require()`s of Node built-ins inside the Node-only features (the ESM loader, worker offload, the jobs' free-memory check, the stdio console, the file logger, the SQLite default paths): each runs only when its feature does, which a page never asks for. A tool that follows `require()` in that file must map Node built-ins to empty modules; bundlers resolve the ES module build instead.
- webpack 5 builds a page (`target: 'web'`) or a Web Worker (`target: 'webworker'`) with no Node fallbacks: the browser builds import no Node built-in, so don't add `resolve.fallback` entries, `node-polyfill-webpack-plugin` or a `node:` scheme rewrite for FrontMCP. A Node-only feature loads its built-ins on first use. The shared local server (`runShared()`) and Unix sockets (`runUnixSocket()`) are left out of the browser builds, and calling them in a page rejects with `BrowserEntryPointUnavailableError` (`BROWSER_ENTRY_POINT_UNAVAILABLE`). Up to 1.10 the SDK's browser build imported `node:cluster`, `node:net`, `node:path`, `node:http`, `node:stream` and `node:os` from that code, so webpack stopped with `UnhandledSchemeError: Reading from "node:net" is not handled by plugins` unless the app stubbed them; Vite and esbuild let them through, and `runShared()` failed in a page with `process is not defined`.
- With Vite 7 (Rollup), don't `await create()` at the top level of the entry module — call it from a function or `.then()`. Rollup can put modules the SDK imports lazily in a chunk that imports the entry back, and the top-level `await` then waits on itself.
- Hook options may be written inline. `useStoreResource` / `useReduxResource` / `useValtioResource` and `useApiClient` register again only when the store name, the server, the set of selector / action names (not their order), or what an API operation declares changes; functions are read from the latest render.
- `useApiClient` sends the arguments an operation declares `in: 'query'` as the query string and `in: 'header'` as headers. `parseOpenApiSpec` fills `operation.parameters`; a hand-written operation lists them itself (`parameters: [{ name: 'limit', in: 'query' }]`), or its non-path, non-`body` arguments are not sent. Arrays and objects follow the parameter's OpenAPI `style` / `explode` (which `parseOpenApiSpec` keeps): a query array repeats the key and a query object sends each property as its own parameter by default (`spaceDelimited`, `pipeDelimited` and `deepObject` are honored); a header array or object is comma-separated.
- `ToolForm` shows an optional enum without a default as unset (an empty choice), and leaves it out of the arguments until the user picks a value.

- `useCallTool`'s `data` is the whole MCP `CallToolResult` (`content`, `structuredContent`, `isError`), not the tool's return value. Render `data.structuredContent ?? data.content`, never `String(data)`. A tool-side failure resolves with `data.isError === true`; `error` is only set when the call throws (for example when the client is not connected).
- `z` is re-exported from `@frontmcp/react`, but `zod` remains a required peer dependency of `@frontmcp/lazy-zod` and must be installed in the consuming project.
- `create({ resources })` takes `@Resource` classes or `resource(...)(handler)` / `resourceTemplate(...)(handler)` values. A plain `{ uri, name, read }` object is rejected with "Expected a class or a resource function".
- The subpath entries (`@frontmcp/react/state`, `/api`, `/ai`, `/router`) share the root entry's provider and server registry, so `useStoreResource`, `useApiClient`, `useAITools` and `useTools` register against the same `FrontMcpProvider`.
- `createRouterEntries()` from `@frontmcp/react/router` returns `{ tools, resources }` that go straight into `create({ tools, resources })`.

For connecting to a remote MCP server (HTTP), create a server-bound `DirectMcpServer` via `connect()` from `@frontmcp/sdk` and pass that instance to the provider.

- `useDynamicTool` registers a **real server tool** (through `server.registerTool()`), so it runs through the server's flows (plugin hooks, authorities, `availableWhen`) and every client sees it. A name a server tool already has is refused and reported through the provider's `onError` (or `console.warn`) — it no longer shadows the server tool; registering it again (a remount) retries it. The provider's tool listing follows the server's `notifications/tools/list_changed`. On a server with several local apps (`FrontMcpInstance.createDirect({ apps: [...] })`) every dynamic tool must say which app it joins: once per server with `<FrontMcpProvider dynamicToolApps={{ default: 'browser' }}>` (keyed by server name; covers `useDynamicTool`, `mcpComponent`, store actions and `useApiClient`), or per tool with `useDynamicTool({ app })`. A `create()` server has one app, so neither is needed. When two mounted components register the same name, the later definition wins until it unmounts, then the earlier component's `execute` takes over again. Outside the provider, `bindDynamicTools(registry, server, { onError, app })` (exported from `@frontmcp/react`) mirrors a `DynamicRegistry` into a server and returns an unbind function.
- Page code can add tools to the running server: `const unregister = await server.registerTool({ name, description, inputSchema, execute })`. The tool joins the server's app, so it is listed and run through the server's flows (plugin hooks, authorities, `availableWhen`). Arguments are not validated against `inputSchema` — validate in `execute`. `execute` runs outside the request's turn, so it may call the server back. A taken name rejects with `ToolNameConflictError`; names are 1–64 characters.
- `registerTool()` checks the definition before adding it: `inputSchema` must be an object schema (`type: 'object'`), and a non-string `title`/`description` or malformed `annotations`/`availableWhen` rejects with `EntryValidationError` instead of breaking `tools/list` for every tool. Registering on a disposed server (or one disposed before the registration completes) rejects with `InternalMcpError`.

## Exposing Tools to Browser Agents (WebMCP)

Install `@frontmcp/plugin-webmcp`, with `@frontmcp/sdk` at the same version (the plugin takes it as a peer), to register the page server's tools with WebMCP (`document.modelContext`), the API Gemini in Chrome and other in-browser agents use:

```typescript
import { WebMcpPlugin } from '@frontmcp/plugin-webmcp';

const server = await create({
  info: { name: 'shop', version: '1.0.0' },
  tools: [SearchProducts, AddToCart],
  plugins: [WebMcpPlugin.init({ prefix: 'shop.' })],
});
```

- Every agent call runs `tools:call-tool` on the `'webmcp'` surface; use `availableWhen: { surface: ['webmcp'] }` for agent-only tools and `['mcp']` to keep a tool away from browser agents.
- Tools added later (`server.registerTool()`, `useDynamicTool`) are registered automatically; `server.dispose()` unregisters everything.
- WebMCP is in origin trial (Chrome/Edge 149–162). Develop with `chrome://flags/#enable-webmcp-testing` and inspect with DevTools → Application → WebMCP. Without `document.modelContext` the plugin does nothing; load a polyfill such as `@mcp-b/global` for other browsers.
- An agent gets each result once: the tool's `structuredContent` alone when its content only repeats it (one text block with the same JSON or primitive), otherwise `{ content }` (plus `structuredContent`, so distinct text and images are kept). `WebMcpPlugin.init({ result: 'both' })` gives `{ content, structuredContent }`, the shape up to 1.9.4.
- Don't start the server on page load just to offer its tools: `create()` with one tool is about 1.5 MB minified (Vite puts about 1.1 MB of it in the page's first chunk and loads about 0.4 MB more when `create()` runs), and evaluating it is one long task (Lighthouse's Total Blocking Time sees it, since Chrome for Testing has WebMCP on). Generate the list at build time with `listWebMcpTools()` and register it with `registerWebMcpTools()` from `@frontmcp/plugin-webmcp/register`, a chunk without the SDK; the server loads on an agent's first call. See `official-plugins` → WebMCP → "Registering tools before the server loads".

## What a Browser Bundle Leaves Out

FrontMCP's optional integrations are optional peer dependencies. In a browser bundle that doesn't install them, the code that would load them is still there, and it fails only when the feature is used:

| Package                                                                                                                 | Loaded by                                           | In a browser bundle without it                                                 |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------ |
| `openai`, `@anthropic-ai/sdk`                                                                                           | Agents' built-in LLM adapters                       | Vite emits a stub chunk; an agent call with that adapter throws                |
| `@vercel/kv`, `@upstash/redis`                                                                                          | `@frontmcp/utils` storage providers                 | Vite emits a stub chunk; a page uses memory storage anyway                     |
| `@enclave-vm/core`                                                                                                      | Jobs' sandbox                                       | Vite emits a stub chunk; running a sandboxed job throws                        |
| `ioredis`, `@frontmcp/storage-sqlite`, `@frontmcp/observability`, `@opentelemetry/api`, `@opentelemetry/sdk-trace-base` | Redis/SQLite stores, metrics, tracing (`require()`) | Not bundled; reached only on server configurations, never by default in a page |

Nothing warns at build time: Vite's stubs for missing optional peers are silent. Install a package only if the page uses that feature.

## Browser vs Node vs SDK Target

| Aspect      | `--target browser` | `--target node`   | `--target sdk`      |
| ----------- | ------------------ | ----------------- | ------------------- |
| Runtime     | Browser            | Node.js server    | Node.js library     |
| Output      | Browser bundle     | Server executable | CJS + ESM + types   |
| HTTP server | No                 | Yes               | No (`serve: false`) |
| Use case    | Frontend apps      | Standalone server | Embed in Node apps  |

## Verification

```bash
# Build
frontmcp build --target browser

# Check output
ls dist/browser/
```

## Common Patterns

| Pattern           | Correct                                           | Incorrect                                   | Why                                                    |
| ----------------- | ------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------ |
| Crypto usage      | `@frontmcp/utils` (uses WebCrypto)                | `node:crypto`                               | `node:crypto` is not available in browsers             |
| Storage           | In-memory stores or remote API                    | SQLite / Redis directly                     | No filesystem or native TCP in browsers                |
| File system ops   | Avoid `@frontmcp/utils` fs functions              | `readFile()`, `writeFile()`                 | fs utilities throw in browser environments             |
| Entry file        | Separate browser entry (`src/client.ts`)          | Reusing server entry point                  | Server entry may import Node-only modules              |
| Provider props    | `<FrontMcpProvider server={await create({...})}>` | `<FrontMcpProvider config={{ serverUrl }}>` | Real prop is `server: DirectMcpServer`; no `serverUrl` |
| Tool listing hook | `useListTools()` -> `{ data: { tools } }`         | `useTools()` -> `{ tools, callTool }`       | `useTools` is not exported; real hooks are split       |

## Verification Checklist

**Build**

- [ ] `frontmcp build --target browser` completes without errors
- [ ] Output directory contains browser-compatible JS bundle
- [ ] No Node.js-only modules are included in the bundle

**Runtime**

- [ ] Bundle loads in the browser without console errors
- [ ] MCP tools are listed and callable from the frontend
- [ ] WebCrypto-based operations (auth, PKCE) work correctly

**Integration**

- [ ] `@frontmcp/react` provider connects to the remote MCP server
- [ ] Tool invocations return expected results in the UI
- [ ] Resources and prompts render correctly in browser components

## Troubleshooting

| Problem                                                             | Cause                                          | Solution                                                                                                    |
| ------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `Module not found: fs`                                              | Node.js module imported in browser bundle      | Use a separate browser entry point that avoids Node-only imports                                            |
| `crypto is not defined`                                             | Using `node:crypto` instead of WebCrypto       | Switch to `@frontmcp/utils` crypto functions                                                                |
| `node:crypto` or `@upstash/redis` unresolved from `@frontmcp/utils` | `@frontmcp/utils` 1.9.2                        | Upgrade: its browser build no longer imports `node:crypto`, and Vite stubs its uninstalled optional peers   |
| `process is not defined` in a Web Worker                            | `@frontmcp/utils` up to 1.10 in a Web Worker   | Upgrade; with Rollup, pass `browser: true` to `@rollup/plugin-node-resolve`                                 |
| webpack: `UnhandledSchemeError: Reading from "node:net"`            | `@frontmcp/sdk` up to 1.10                     | Upgrade, and drop the Node fallbacks the app added for FrontMCP                                             |
| `BrowserEntryPointUnavailableError`                                 | `runShared()` or `runUnixSocket()` in a page   | Call it from a Node entry; a page serves its tools with `create()`                                          |
| CORS errors on tool calls                                           | MCP server missing CORS headers                | Configure CORS middleware on the MCP server                                                                 |
| Bundle too large                                                    | All server-side code included                  | Use `--target browser` and a dedicated client entry file                                                    |
| Long task / Total Blocking Time on load with WebMCP                 | The server starts on page load to offer tools  | Register a build-time list with `registerWebMcpTools()` and load the server on the first agent call         |
| `__vite-optional-peer-dep` chunk throws                             | An optional peer is not installed              | Install it if the page uses that feature (see What a Browser Bundle Leaves Out)                             |
| `@frontmcp/utils` fs throws                                         | File system ops called in browser              | Remove fs calls; use API endpoints or in-memory alternatives                                                |
| `BrowserStoreUnavailableError` at startup                           | A store would open Redis or SQLite             | Set every switch the message names (`tasks.store: false`, ...), or leave `redis`/`sqlite` out of the config |
| `AsyncContextOverlapError`                                          | Concurrent tool calls inside one request       | Await the calls one after another (no `AsyncContext` in browser)                                            |
| A call never returns                                                | A tool calls its own server via a client       | Call other tools through `this.scope` flows                                                                 |
| `create()` never settles (Vite 7)                                   | Top-level `await create()` in the entry module | Call `create()` from a function or `.then()`                                                                |

## Examples

| Example                                                                                               | Level        | Description                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`browser-build-with-custom-entry`](../examples/build-for-browser/browser-build-with-custom-entry.md) | Intermediate | Build a browser bundle using a dedicated client entry file that avoids Node.js-only imports. Re-export the real `@frontmcp/react` symbols (`useListTools`, `useListResources`, `useCallTool`) — `useTools`/`useResources` do not exist. |
| [`browser-crypto-and-storage`](../examples/build-for-browser/browser-crypto-and-storage.md)           | Advanced     | Use `@frontmcp/utils` crypto in the browser, and create the FrontMCP server with `create()` from `@frontmcp/sdk` so the React provider can consume it via the `server` prop.                                                            |
| [`react-provider-setup`](../examples/build-for-browser/react-provider-setup.md)                       | Basic        | Connect a React application to a FrontMCP server using `@frontmcp/react`. `FrontMcpProvider` takes a `DirectMcpServer` instance via the `server` prop — there is no `serverUrl` option.                                                 |

> See all examples in [`examples/build-for-browser/`](../examples/build-for-browser/)

## Reference

- **Docs:** <https://frontmcp.dev/reference/deployment/browser>
- **Related skills:** `build-for-sdk`, `build-for-cli`, `deploy-to-cloudflare`
