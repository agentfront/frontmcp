# @frontmcp/plugin-codecall

A FrontMCP plugin for servers with more tools than a model can usefully read. Instead of every tool and its schema,
`tools/list` shows CodeCall's meta-tools. The model searches your tools with `codecall:search`, reads the schemas of
the ones it picked with `codecall:describe`, and calls them: one at a time with `codecall:invoke`, or several in one
request with `codecall:execute`, which runs a short program written in AgentScript, a restricted subset of
JavaScript, in a sandbox on the server. A script can loop over results, filter and join them, so only the answer goes
back to the model.

[![npm](https://img.shields.io/npm/v/@frontmcp/plugin-codecall.svg)](https://www.npmjs.com/package/@frontmcp/plugin-codecall) [![License](https://img.shields.io/npm/l/@frontmcp/plugin-codecall.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

```bash
npm install @frontmcp/plugin-codecall @frontmcp/plugin-cache @frontmcp/sdk
```

Requires Node.js 24 or later. [`@frontmcp/plugin-cache`](https://www.npmjs.com/package/@frontmcp/plugin-cache) is a
required peer dependency: install it next to this package, at the same version. CodeCall registers the cache plugin
itself, so you don't list it in `plugins`. Keep `@frontmcp/sdk` on the same version too.

For `embedding: { strategy: 'ml' }`, also install `@huggingface/transformers`, an optional peer dependency of
`vectoriadb`, which CodeCall uses for search.

## Usage

Register the plugin with `init()`, in the `plugins` of an `@App` or of `@FrontMcp`:

```ts
import { CodeCallPlugin } from '@frontmcp/plugin-codecall';
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'list_tickets',
  description: 'List support tickets',
  inputSchema: { status: z.enum(['open', 'closed']) },
})
class ListTickets extends ToolContext {
  async execute({ status }: { status: 'open' | 'closed' }) {
    return { tickets: [{ id: 'T-1', status, customerId: 'C-7' }] };
  }
}

@Tool({ name: 'get_customer', description: 'Get a customer by id', inputSchema: { id: z.string() } })
class GetCustomer extends ToolContext {
  async execute({ id }: { id: string }) {
    return { id, name: 'Ada', plan: 'pro' };
  }
}

@App({
  id: 'help-desk',
  name: 'Help Desk',
  tools: [ListTickets, GetCustomer],
  plugins: [CodeCallPlugin.init({ mode: 'codecall_only' })],
})
class HelpDeskApp {}

@FrontMcp({ info: { name: 'help-desk', version: '1.0.0' }, apps: [HelpDeskApp] })
export default class Server {}
```

`tools/list` now shows only the `codecall:*` tools. Registered on one app, CodeCall still hides every app's tools
(unless you set `appIds`), and its tools search and call every app's tools.

Every option is optional: `CodeCallPlugin.init()` and `plugins: [CodeCallPlugin]` use the defaults. `init()` checks
the options when your module is imported, and throws a `ZodError` naming a wrong one.

## The tools CodeCall adds

| Tool                       | What it does                                                  |
| -------------------------- | ------------------------------------------------------------- |
| `codecall:search`          | Finds tools for short queries (`queries`: 1 to 10 phrases).   |
| `codecall:describe`        | Returns tools' input and output schemas, with usage examples. |
| `codecall:invoke`          | Calls one tool and returns its result.                        |
| `codecall:execute`         | Runs an AgentScript program that calls tools.                 |
| `codecall:searchSkills`    | Finds skills that call tools.                                 |
| `codecall:searchKnowledge` | Finds skills that are only instructions.                      |

They're listed in every mode, and neither `codecall:invoke` nor a script can call them.

## Modes

| `mode`                      | In `tools/list`                                                           | What CodeCall may use                                    |
| --------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| `'codecall_only'` (default) | CodeCall's tools, and tools with `codecall: { visibleInListTools: true }` | Every tool, except those with `enabledInCodeCall: false` |
| `'codecall_opt_in'`         | Every tool, except those with `visibleInListTools: false`                 | Only tools with `codecall: { enabledInCodeCall: true }`  |
| `'metadata_driven'`         | Every tool, except those with `visibleInListTools: false`                 | Every tool, except those with `enabledInCodeCall: false` |

A client that calls a tool CodeCall takes out of `tools/list` gets `Tool "…" not found` (`TOOL_NOT_FOUND`). Calls
from the server, through CodeCall's own tools or `this.callTool()`, still reach it. In `codecall_only`, a tool a
client or widget calls directly needs `visibleInListTools: true`.

The plugin adds a `codecall` field to `@Tool`:

```ts
@Tool({
  name: 'delete_customer',
  description: 'Delete a customer and all their tickets',
  inputSchema: { id: z.string() },
  codecall: { enabledInCodeCall: false, visibleInListTools: true },
})
```

## Options

| Option           | Default                | Description                                                                                                                                      |
| ---------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mode`           | `'codecall_only'`      | Which tools `tools/list` shows, and which CodeCall may use. See [Modes](#modes).                                                                 |
| `appIds`         | every app              | In `codecall_only`, hide only these apps' tools from `tools/list`. It doesn't limit what CodeCall searches or calls.                             |
| `includeTools`   |                        | `(tool) => boolean`. A tool it returns `false` for isn't searched, described, invoked or callable from scripts.                                  |
| `directCalls`    | unset                  | `{ enabled, allowedTools?, filter? }`, limits what `codecall:invoke` may call.                                                                   |
| `vm`             | `{ preset: 'secure' }` | The sandbox's limits: `preset` (`'locked_down'`, `'secure'`, `'balanced'`, `'experimental'`), `timeoutMs`, `maxSteps`, `allowLoops`, and others. |
| `embedding`      | TF-IDF                 | How `codecall:search` ranks tools: `strategy` (`'tfidf'` or `'ml'`), `modelName`, `cacheDir`, `useHNSW`, `synonymExpansion`.                     |
| `sidecar`        | `{ enabled: false }`   | Allows scripts longer than 64 KB.                                                                                                                |
| `topK`           | `8`                    | Results per query when a `codecall:search` call doesn't give its own `topK`.                                                                     |
| `maxDefinitions` | `8`                    | Most tools one `codecall:describe` call may name.                                                                                                |

```ts
CodeCallPlugin.init({
  mode: 'codecall_opt_in',
  directCalls: { enabled: true, allowedTools: ['get_customer'] },
  vm: { preset: 'secure', timeoutMs: 3500 },
  embedding: { strategy: 'ml' },
});
```

## Limits

- **Script time and calls.** Under the default `secure` preset, a script times out after 3.5 seconds (`vm.timeoutMs`)
  and may call tools up to 5,000 times (`vm.maxSteps`). Loops are limited to `for…of`, and `for (…; …; …)` with
  `vm.allowLoops: true`. The other presets set other limits.
- **Calls to one tool.** More than `vm.rapidEnumerationThreshold` calls (default 30) to one tool within about 2
  seconds stop the script with `[RAPID_ENUMERATION]`; calls made through `parallel()` count. Set per-tool values with
  `vm.rapidEnumerationOverrides` (`{ 'users:get': 100 }`). The sandbox's message says "in 5s", but it keeps only the
  last 2 seconds of calls.
- **Embedding model.** With `embedding.strategy: 'ml'`, CodeCall loads a local model (`Xenova/all-MiniLM-L6-v2` by
  default), downloading it into `embedding.cacheDir` if it isn't there. When the model can't be loaded or used
  (offline with nothing cached, `@huggingface/transformers` missing, or embedding the tools fails), CodeCall logs one
  warning and searches with TF-IDF. A tool whose metadata can't be read is skipped with a warning; the others stay
  searchable.

## Docs

- [CodeCall reference](https://frontmcp.dev/reference/plugins/codecall): every option, the tools, AgentScript, the
  sandbox's limits and security, with runnable examples
- [Letting the Model Write Code with CodeCall](https://frontmcp.dev/learn/letting-the-model-write-code-with-codecall):
  a step-by-step lesson
- [CRM with CodeCall](https://frontmcp.dev/examples/crm-with-codecall): a whole server built on it
- [Plugins and adapters](https://frontmcp.dev/reference/plugins): where to register a plugin

## Related packages

- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk): the framework this plugin extends
- [`@frontmcp/plugin-cache`](https://www.npmjs.com/package/@frontmcp/plugin-cache): a required peer dependency
- [`@frontmcp/plugin-skilled-openapi`](https://www.npmjs.com/package/@frontmcp/plugin-skilled-openapi): serves a
  REST API as skills, which `codecall:searchSkills` finds
- [`@frontmcp/plugins`](https://www.npmjs.com/package/@frontmcp/plugins): a meta-package that re-exports this plugin
  with three others

## Contributing

Source: [`plugins/plugin-codecall`](https://github.com/agentfront/frontmcp/tree/main/plugins/plugin-codecall). Issues
and pull requests are welcome; see [CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
