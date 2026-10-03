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

| Feature                     | Browser Support | Notes                                     |
| --------------------------- | --------------- | ----------------------------------------- |
| Tools (client-side)         | Yes             | Can define and run tools                  |
| Resources                   | Yes             | Read-only access                          |
| Prompts                     | Yes             | Full support                              |
| Redis                       | No              | Use in-memory or connect to server        |
| SQLite                      | No              | No filesystem access                      |
| File system utilities       | No              | `@frontmcp/utils` fs ops throw in browser |
| Crypto (`@frontmcp/utils`)  | Yes             | Uses WebCrypto API                        |
| Direct client (`connect()`) | Yes             | In-memory connection                      |

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

- `useCallTool`'s `data` is the whole MCP `CallToolResult` (`content`, `structuredContent`, `isError`), not the tool's return value. Render `data.structuredContent ?? data.content`, never `String(data)`. A tool-side failure resolves with `data.isError === true`; `error` is only set when the call throws (for example when the client is not connected).
- `z` is re-exported from `@frontmcp/react`, but `zod` remains a required peer dependency of `@frontmcp/lazy-zod` and must be installed in the consuming project.
- `create({ resources })` takes `@Resource` classes or `resource(...)(handler)` / `resourceTemplate(...)(handler)` values. A plain `{ uri, name, read }` object is rejected with "Expected a class or a resource function".
- The subpath entries (`@frontmcp/react/state`, `/api`, `/ai`, `/router`) share the root entry's provider and server registry, so `useStoreResource`, `useApiClient`, `useAITools` and `useTools` register against the same `FrontMcpProvider`.
- `createRouterEntries()` from `@frontmcp/react/router` returns `{ tools, resources }` that go straight into `create({ tools, resources })`.

For connecting to a remote MCP server (HTTP), create a server-bound `DirectMcpServer` via `connect()` from `@frontmcp/sdk` and pass that instance to the provider.

- `useDynamicTool` registers a **real server tool** (through `server.registerTool()`), so it runs through the server's flows (plugin hooks, authorities, `availableWhen`) and every client sees it. A name a server tool already has is refused and reported through the provider's `onError` (or `console.warn`) — it no longer shadows the server tool; registering it again (a remount) retries it. The provider's tool listing follows the server's `notifications/tools/list_changed`. On a server with several local apps (`FrontMcpInstance.createDirect({ apps: [...] })`) every dynamic tool must say which app it joins: once per server with `<FrontMcpProvider dynamicToolApps={{ default: 'browser' }}>` (keyed by server name; covers `useDynamicTool`, `mcpComponent`, store actions and `useApiClient`), or per tool with `useDynamicTool({ app })`. A `create()` server has one app, so neither is needed.
- Page code can add tools to the running server: `const unregister = await server.registerTool({ name, description, inputSchema, execute })`. The tool joins the server's app, so it is listed and run through the server's flows (plugin hooks, authorities, `availableWhen`). Arguments are not validated against `inputSchema` — validate in `execute`. `execute` runs outside the request's turn, so it may call the server back. A taken name rejects with `ToolNameConflictError`; names are 1–64 characters.
- `registerTool()` checks the definition before adding it: `inputSchema` must be an object schema (`type: 'object'`), and a non-string `title`/`description` or malformed `annotations`/`availableWhen` rejects with `EntryValidationError` instead of breaking `tools/list` for every tool. Registering on a disposed server (or one disposed before the registration completes) rejects with `InternalMcpError`.

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

| Problem                     | Cause                                     | Solution                                                         |
| --------------------------- | ----------------------------------------- | ---------------------------------------------------------------- |
| `Module not found: fs`      | Node.js module imported in browser bundle | Use a separate browser entry point that avoids Node-only imports |
| `crypto is not defined`     | Using `node:crypto` instead of WebCrypto  | Switch to `@frontmcp/utils` crypto functions                     |
| CORS errors on tool calls   | MCP server missing CORS headers           | Configure CORS middleware on the MCP server                      |
| Bundle too large            | All server-side code included             | Use `--target browser` and a dedicated client entry file         |
| `@frontmcp/utils` fs throws | File system ops called in browser         | Remove fs calls; use API endpoints or in-memory alternatives     |
| `AsyncContextOverlapError`  | Concurrent tool calls inside one request  | Await the calls one after another (no `AsyncContext` in browser) |
| A call never returns        | A tool calls its own server via a client  | Call other tools through `this.scope` flows                      |

## Examples

| Example                                                                                               | Level        | Description                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`browser-build-with-custom-entry`](../examples/build-for-browser/browser-build-with-custom-entry.md) | Intermediate | Build a browser bundle using a dedicated client entry file that avoids Node.js-only imports. Re-export the real `@frontmcp/react` symbols (`useListTools`, `useListResources`, `useCallTool`) — `useTools`/`useResources` do not exist. |
| [`browser-crypto-and-storage`](../examples/build-for-browser/browser-crypto-and-storage.md)           | Advanced     | Use `@frontmcp/utils` crypto in the browser, and create the FrontMCP server with `create()` from `@frontmcp/sdk` so the React provider can consume it via the `server` prop.                                                            |
| [`react-provider-setup`](../examples/build-for-browser/react-provider-setup.md)                       | Basic        | Connect a React application to a FrontMCP server using `@frontmcp/react`. `FrontMcpProvider` takes a `DirectMcpServer` instance via the `server` prop — there is no `serverUrl` option.                                                 |

> See all examples in [`examples/build-for-browser/`](../examples/build-for-browser/)

## Reference

- **Docs:** <https://docs.agentfront.dev/frontmcp/deployment/browser-compatibility>
- **Related skills:** `build-for-sdk`, `build-for-cli`, `deploy-to-cloudflare`
