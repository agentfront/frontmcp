# @frontmcp/plugin-webmcp

Offers the tools of a [FrontMCP](https://frontmcp.dev) server that runs **in the page** to the agents in the user's
browser, through [WebMCP](https://webmachinelearning.github.io/webmcp/) (`document.modelContext`): the browser's own
assistant, an extension, or the developer tools. Use it on a website that creates a FrontMCP server in the page, often
under `@frontmcp/react`. The plugin registers the server's tools, keeps them in step as tools come and go, and runs each
agent's call through the server's own flow.

[![npm](https://img.shields.io/npm/v/@frontmcp/plugin-webmcp.svg)](https://www.npmjs.com/package/@frontmcp/plugin-webmcp) [![License](https://img.shields.io/npm/l/@frontmcp/plugin-webmcp.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

```bash
npm install @frontmcp/sdk @frontmcp/plugin-webmcp
```

Use the same version for both packages. The plugin's peer dependency `@frontmcp/lazy-zod` comes with the SDK. The
build-time helper `listWebMcpTools()` runs in Node.js 24 or later.

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

Register the plugin with `WebMcpPlugin.init()`, with or without options; `plugins: [WebMcpPlugin]` uses the defaults.
Install it once: it offers every tool the server lists, whichever app it's registered on.

Once the server is ready, every tool it lists on the `'webmcp'` surface is registered with
`document.modelContext.registerTool()`:

- **Kept in sync.** Tools added or removed later, including tools added with `server.registerTool()` and React's
  `useDynamicTool()`, are registered or unregistered as they change.
- **Cleaned up.** Every tool is unregistered when `server.dispose()` runs.

An agent's call runs the server's `tools:call-tool` flow, so hooks, authorities, quota and `availableWhen` apply to it
as they do to any MCP client.

## Options

All optional.

| Option         | Type                                           | Default                            | Description                                                                               |
| -------------- | ---------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `prefix`       | `string`                                       | `''`                               | Prepended to every exposed tool name, e.g. `'shop.'`.                                     |
| `include`      | `(tool) => boolean`                            | every tool                         | Decides which listed tools are exposed. Runs after `availableWhen` and authorities.       |
| `exposedTo`    | `string[]`                                     |                                    | Other origins (e.g. an iframe's parent) the tools are offered to.                         |
| `authContext`  | `DirectAuthContext \| () => DirectAuthContext` | an anonymous caller, `anon:webmcp` | Who the server sees calling. A function is called again for every listing and every call. |
| `modelContext` | `ModelContext`                                 | `document.modelContext`            | The context to register with: a polyfill, or a test double.                               |
| `result`       | `'structured' \| 'content' \| 'both'`          | `'structured'`                     | What a call resolves to (see [Results](#how-tools-are-translated)).                       |

Without `authContext`, every call comes from an anonymous caller, so a tool that refuses anonymous callers refuses
agents too. To let agents act as the person using the page, pass that user, for example
`authContext: () => ({ user: { sub: userId, roles: ['agent'] } })`.

## Choosing which tools agents see

Tools are listed through the `'webmcp'` call surface, so `availableWhen` decides per tool:

```typescript
import { Tool, ToolContext } from '@frontmcp/sdk';

@Tool({ name: 'checkout', description: 'Check out the cart', inputSchema: {}, availableWhen: { surface: ['webmcp'] } })
export class Checkout extends ToolContext {
  async execute() {
    return { ordered: true };
  }
}

@Tool({ name: 'admin_reset', description: 'Reset the store', inputSchema: {}, availableWhen: { surface: ['mcp'] } })
export class AdminReset extends ToolContext {
  async execute() {
    return { reset: true };
  }
}
```

`checkout` is offered only to in-browser agents, and `admin_reset` never through WebMCP.

## How tools are translated

- **Names.** Names become WebMCP-valid. Characters outside `[A-Za-z0-9_.-]` become `_` (so `app:tool` becomes
  `app_tool`), names are cut to 128 characters, and collisions get `_2`, `_3`, …
- **Annotations.** MCP's `readOnlyHint` maps to `readOnlyHint`. An explicit `destructiveHint: true` maps to
  `consequentialHint`, and an explicit `openWorldHint: true` to `untrustedContentHint`.
- **Results.** An agent reads the whole result as text, so by default it gets each result once. With
  `result: 'structured'` (the default) a call resolves to the tool's `structuredContent` alone when its content only
  repeats it: one text block with the same JSON, or the primitive a `{ content }` wrapper holds, as the server writes
  it for clients that don't read structured output. Otherwise it resolves to `{ content }`, plus `structuredContent`
  when there is one, so text that says more and images are kept. `'content'` always resolves to `{ content }`, and
  `'both'` to `{ content, structuredContent }` as an MCP client gets them (the shape up to 1.9.4). `_meta` is never
  included.
- **Errors.** An error result (`isError`), or an error from the server, rejects with its message.

## Registering tools before the server loads

A server in the page is a large bundle, and starting it is one long task. To keep it off page load, compute the tool
list at build time and register it in the page; the server loads on an agent's first call.

`server.ts`, one factory for the build script and the page:

```typescript
import { WebMcpPlugin, type ModelContext } from '@frontmcp/plugin-webmcp';
import { create } from '@frontmcp/sdk';

export function createShopServer({ modelContext }: { modelContext?: ModelContext } = {}) {
  return create({
    info: { name: 'shop', version: '1.0.0' },
    tools: [SearchProducts, AddToCart],
    plugins: [WebMcpPlugin.init({ prefix: 'shop.', modelContext })],
  });
}
```

The build script (Node.js):

```typescript
import { writeFile } from 'node:fs/promises';

import { listWebMcpTools } from '@frontmcp/plugin-webmcp';

import { createShopServer } from './server';

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

- `listWebMcpTools(factory)` builds the server with a `modelContext` that records what the plugin registers, returns
  those descriptors (name, title, description, input schema, hints) and disposes the server. The factory must pass the
  `modelContext` it is given to `WebMcpPlugin.init()`.
- `registerWebMcpTools(modelContext, tools, loadServer, { exposedTo? })` registers the list at once. The first call
  loads the server with `loadServer` (once, however many calls arrive together) and runs through the plugin; a failed
  load rejects that call (a server it built is disposed, and the listed tools stay), and the next call tries again.
  From then on the plugin registers and unregisters tools as the server's tools change, and `server.dispose()`
  unregisters them. A listed tool the loaded server lacks is unregistered. Without a `modelContext` (no WebMCP) it does
  nothing.
- `@frontmcp/plugin-webmcp/register` does not import `@frontmcp/sdk`; it is a few kilobytes. It exports
  `registerWebMcpTools`, `resolveDocumentModelContext` and `isWebMcpSupported`.

## Browser support

WebMCP is a draft. Chrome and Edge have it behind a flag or an origin trial; for local development, turn on
`chrome://flags/#enable-webmcp-testing`. The plugin follows the draft of 2026-09-30. See
[Browsers](https://frontmcp.dev/reference/plugins/webmcp#browsers) for where `document.modelContext` is available.

Where `document.modelContext` is missing, the plugin does nothing and the server works as before;
`isWebMcpSupported()` tells you up front. To support other browsers, load a polyfill that installs
`document.modelContext` before creating the server, such as
[`@mcp-b/global`](https://www.npmjs.com/package/@mcp-b/global), or pass one as `modelContext`.

WebMCP exposes tools only: resources and prompts stay MCP-only.

## Docs

- [WebMCP plugin reference](https://frontmcp.dev/reference/plugins/webmcp): options, translation, who the server sees
  calling, and troubleshooting.
- [Running in the browser](https://frontmcp.dev/reference/deployment/browser): what a FrontMCP server can do in a web
  page.

## Related packages

- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk): the FrontMCP framework, including `create()` for a
  server in the page.
- [`@frontmcp/react`](https://www.npmjs.com/package/@frontmcp/react): React hooks and components for a server in the
  page; tools a component adds with `useDynamicTool()` are offered to agents while it's mounted.

## Contributing

Source: [`plugins/plugin-webmcp`](https://github.com/agentfront/frontmcp/tree/main/plugins/plugin-webmcp). Issues and
pull requests are welcome; see [CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
