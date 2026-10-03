# @frontmcp/plugin-webmcp

Expose the tools of a FrontMCP server that runs **in the page** to in-browser agents through
[WebMCP](https://webmachinelearning.github.io/webmcp/) (`document.modelContext`). Agents such as
Gemini in Chrome, the Model Context Tool Inspector extension, and DevTools' WebMCP panel can then
discover and call them.

## Installation

```bash
npm install @frontmcp/plugin-webmcp
```

## Usage

```typescript
import { WebMcpPlugin } from '@frontmcp/plugin-webmcp';
import { create } from '@frontmcp/sdk';

const server = await create({
  info: { name: 'shop', version: '1.0.0' },
  tools: [SearchProducts, AddToCart],
  plugins: [WebMcpPlugin.init({ prefix: 'shop.' })],
});
```

Install the plugin with `WebMcpPlugin.init()` (with or without options).

Once the server is ready, every tool it lists on the `'webmcp'` surface is registered with
`document.modelContext.registerTool()`:

- **Kept in sync.** Tools added or removed later, including tools added with `server.registerTool()`
  and React's `useDynamicTool`, are registered or unregistered as they change.
- **Cleaned up.** Every tool is unregistered when `server.dispose()` runs.

An agent's call runs the server's `tools:call-tool` flow, so hooks, authorities, quota and
`availableWhen` apply to it as they do to any MCP client.

## Options

| Option         | Type                                           | Default                   | Description                                                        |
| -------------- | ---------------------------------------------- | ------------------------- | ------------------------------------------------------------------ |
| `prefix`       | `string`                                       | `''`                      | Prepended to every exposed tool name, e.g. `'shop.'`.              |
| `include`      | `(tool) => boolean`                            | all                       | Decides which listed tools are exposed.                            |
| `exposedTo`    | `string[]`                                     | —                         | Other origins (e.g. an iframe's parent) the tools are offered to.  |
| `authContext`  | `DirectAuthContext \| () => DirectAuthContext` | anonymous `webmcp` caller | Who the server sees calling. A function is resolved on every call. |
| `modelContext` | `ModelContext`                                 | `document.modelContext`   | The context to register with: a polyfill, or a test double.        |

## Choosing which tools agents see

Tools are listed through the `'webmcp'` call surface, so `availableWhen` decides per tool:

```typescript
@Tool({ name: 'checkout', availableWhen: { surface: ['webmcp'] } }) // in-browser agents only
@Tool({ name: 'admin_reset', availableWhen: { surface: ['mcp'] } }) // never exposed through WebMCP
```

## How tools are translated

- **Names.** Names become WebMCP-valid. Characters outside `[A-Za-z0-9_.-]` become `_` (so
  `app:tool` becomes `app_tool`), names are cut to 128 characters, and collisions get `_2`, `_3`, …
- **Annotations.** MCP's `readOnlyHint` maps to `readOnlyHint`. An explicit `destructiveHint: true`
  maps to `consequentialHint`, and an explicit `openWorldHint: true` to `untrustedContentHint`.
- **Results.** A call resolves to `{ content, structuredContent? }`, without `_meta`.
- **Errors.** An error result (`isError`), or an error from the server, rejects with its message.

## Browser support

WebMCP is in origin trial in Chrome and Edge (Chrome 149+). For local development, enable
`chrome://flags/#enable-webmcp-testing`.

Where `document.modelContext` is missing, the plugin does nothing; `isWebMcpSupported()` tells you
up front. To support other browsers, load a polyfill that installs `document.modelContext` before
creating the server, such as [`@mcp-b/global`](https://github.com/WebMCP-org/npm-packages) (which
also bridges the page's tools to the MCP-B browser extension), or pass one as `modelContext`.

WebMCP exposes tools only: resources and prompts stay MCP-only.
