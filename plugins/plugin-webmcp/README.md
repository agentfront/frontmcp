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

| Option         | Type                                           | Default                   | Description                                                         |
| -------------- | ---------------------------------------------- | ------------------------- | ------------------------------------------------------------------- |
| `prefix`       | `string`                                       | `''`                      | Prepended to every exposed tool name, e.g. `'shop.'`.               |
| `include`      | `(tool) => boolean`                            | all                       | Decides which listed tools are exposed.                             |
| `exposedTo`    | `string[]`                                     | —                         | Other origins (e.g. an iframe's parent) the tools are offered to.   |
| `authContext`  | `DirectAuthContext \| () => DirectAuthContext` | anonymous `webmcp` caller | Who the server sees calling. A function is resolved on every call.  |
| `modelContext` | `ModelContext`                                 | `document.modelContext`   | The context to register with: a polyfill, or a test double.         |
| `result`       | `'structured' \| 'content' \| 'both'`          | `'structured'`            | What a call resolves to (see [Results](#how-tools-are-translated)). |

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
- **Results.** An agent reads the whole result as text, so by default it gets each result once. With
  `result: 'structured'` (the default) a call resolves to the tool's `structuredContent` alone when its content only
  repeats it: one text block with the same JSON, or the primitive a `{ content }` wrapper holds, as the server writes
  it for clients that don't read structured output. Otherwise it resolves to `{ content }`, plus `structuredContent`
  when there is one, so text that says more and images are kept. `'content'` always resolves to `{ content }`, and
  `'both'` to `{ content, structuredContent }` as an MCP client gets them (the shape up to 1.9.4). `_meta` is never
  included.
- **Errors.** An error result (`isError`), or an error from the server, rejects with its message.

## Registering tools before the server loads

A server in the page is a large bundle, and starting it is one long task. To keep it off page load, compute the
tool list at build time and register it in the page; the server loads on an agent's first call:

`server.ts`, one factory for the build script and the page:

```typescript
export function createShopServer({ modelContext }: { modelContext?: ModelContext } = {}) {
  return create({
    info: { name: 'shop', version: '1.0.0' },
    tools: [SearchProducts, AddToCart],
    plugins: [WebMcpPlugin.init({ prefix: 'shop.', modelContext })],
  });
}
```

The build script (Node):

```typescript
import { listWebMcpTools } from '@frontmcp/plugin-webmcp';

const tools = await listWebMcpTools((modelContext) => createShopServer({ modelContext }));
await writeFile('src/webmcp-tools.json', JSON.stringify(tools));
```

The page entry, a chunk without the SDK:

```typescript
import { registerWebMcpTools, resolveDocumentModelContext } from '@frontmcp/plugin-webmcp/register';

import tools from './webmcp-tools.json';

void registerWebMcpTools(resolveDocumentModelContext(), tools, (modelContext) =>
  import('./server').then(({ createShopServer }) => createShopServer({ modelContext })),
);
```

- `listWebMcpTools(factory)` builds the server with a `modelContext` that records what the plugin registers,
  returns those descriptors (name, title, description, input schema, hints) and disposes the server. The factory
  must pass the `modelContext` it is given to `WebMcpPlugin.init()`.
- `registerWebMcpTools(modelContext, tools, loadServer, { exposedTo? })` registers the list at once. The first call
  loads the server with `loadServer` (once, however many calls arrive together) and runs through the plugin; a failed
  load rejects that call (a server it built is disposed, and the listed tools stay), and the next call tries again. From then on the plugin registers and unregisters tools as
  the server's tools change, and `server.dispose()` unregisters them. A listed tool the loaded server lacks is
  unregistered. Without a `modelContext` (no WebMCP) it does nothing.
- `@frontmcp/plugin-webmcp/register` does not import `@frontmcp/sdk`; it is a few kilobytes.

## Browser support

WebMCP is in origin trial in Chrome and Edge (Chrome 149+). For local development, enable
`chrome://flags/#enable-webmcp-testing`.

Where `document.modelContext` is missing, the plugin does nothing; `isWebMcpSupported()` tells you
up front. To support other browsers, load a polyfill that installs `document.modelContext` before
creating the server, such as [`@mcp-b/global`](https://github.com/WebMCP-org/npm-packages) (which
also bridges the page's tools to the MCP-B browser extension), or pass one as `modelContext`.

WebMCP exposes tools only: resources and prompts stay MCP-only.
