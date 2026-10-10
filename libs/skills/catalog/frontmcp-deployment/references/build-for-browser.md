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

In a page the server logs at `warn` unless `logging.level` is set, and it never prints the "No distributed storage backend detected in production" warning (a browser bundle has `NODE_ENV=production`, but there is no Redis to configure). Up to 1.9.4 it logged about 20 INFO lines while starting, an INFO block on every tool call, and that warning once per scope.

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

Install `@frontmcp/plugin-webmcp` to register the page server's tools with WebMCP (`document.modelContext`), the API Gemini in Chrome and other in-browser agents use:

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
- An agent gets each result once: the tool's `structuredContent` alone when it has one and its content is only text, otherwise `{ content }` (plus `structuredContent` when there are images or other parts). `WebMcpPlugin.init({ result: 'both' })` gives `{ content, structuredContent }`, the shape up to 1.9.4.
- Don't start the server on page load just to offer its tools: `create()` alone is about 3 MB minified and evaluating it is one long task (Lighthouse's Total Blocking Time sees it, since Chrome for Testing has WebMCP on). Generate the list at build time with `listWebMcpTools()` and register it with `registerWebMcpTools()` from `@frontmcp/plugin-webmcp/register`, a chunk without the SDK; the server loads on an agent's first call. See `official-plugins` → WebMCP → "Registering tools before the server loads".

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

| Problem                                                             | Cause                                          | Solution                                                                                                  |
| ------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `Module not found: fs`                                              | Node.js module imported in browser bundle      | Use a separate browser entry point that avoids Node-only imports                                          |
| `crypto is not defined`                                             | Using `node:crypto` instead of WebCrypto       | Switch to `@frontmcp/utils` crypto functions                                                              |
| `node:crypto` or `@upstash/redis` unresolved from `@frontmcp/utils` | `@frontmcp/utils` 1.9.2                        | Upgrade: its browser build no longer imports `node:crypto`, and Vite stubs its uninstalled optional peers |
| CORS errors on tool calls                                           | MCP server missing CORS headers                | Configure CORS middleware on the MCP server                                                               |
| Bundle too large                                                    | All server-side code included                  | Use `--target browser` and a dedicated client entry file                                                  |
| Long task / Total Blocking Time on load with WebMCP                 | The server starts on page load to offer tools  | Register a build-time list with `registerWebMcpTools()` and load the server on the first agent call       |
| `__vite-optional-peer-dep` chunk throws                             | An optional peer is not installed              | Install it if the page uses that feature (see What a Browser Bundle Leaves Out)                           |
| `@frontmcp/utils` fs throws                                         | File system ops called in browser              | Remove fs calls; use API endpoints or in-memory alternatives                                              |
| `AsyncContextOverlapError`                                          | Concurrent tool calls inside one request       | Await the calls one after another (no `AsyncContext` in browser)                                          |
| A call never returns                                                | A tool calls its own server via a client       | Call other tools through `this.scope` flows                                                               |
| `create()` never settles (Vite 7)                                   | Top-level `await create()` in the entry module | Call `create()` from a function or `.then()`                                                              |

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
