<div align="center">

<a href="https://frontmcp.dev">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/agentfront/frontmcp/v1.9.6/.github/assets/readme/hero.svg">
  <img src="https://raw.githubusercontent.com/agentfront/frontmcp/v1.9.6/.github/assets/readme/hero.light.svg" alt="FrontMCP - The TypeScript way to build MCP servers" width="100%">
</picture>
</a>

</div>

# @frontmcp/sdk

The core of [FrontMCP](https://frontmcp.dev), a TypeScript framework for building
[Model Context Protocol](https://modelcontextprotocol.io) (MCP) servers. You write tools, resources and prompts as
decorated classes; the SDK handles the protocol, the transports, sessions, authentication, dependency injection and the
request pipeline. The same server runs on your machine, in Docker, on Vercel or AWS Lambda, and on Cloudflare Workers.

Use it to build an MCP server, or to run one inside another program. The
[`frontmcp`](https://www.npmjs.com/package/frontmcp) CLI creates, runs, tests and builds the project around it.

[![npm](https://img.shields.io/npm/v/@frontmcp/sdk.svg)](https://www.npmjs.com/package/@frontmcp/sdk)
[![Node](https://img.shields.io/node/v/@frontmcp/sdk.svg)](https://nodejs.org)
[![License](https://img.shields.io/npm/l/@frontmcp/sdk.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

Start a new project with the CLI, which sets everything up:

```bash
npx frontmcp create my-app
```

Or add the SDK to a project you already have:

```bash
npm install @frontmcp/sdk reflect-metadata
npm install -D frontmcp typescript@^5 @types/node@^24
npx frontmcp init
```

FrontMCP needs Node.js 24 or later. `frontmcp init` turns on `experimentalDecorators` and `emitDecoratorMetadata` in
`tsconfig.json`. Import `reflect-metadata` once, at the top of your entry file, before anything from FrontMCP.

npm and pnpm install the SDK's required peer dependencies (`express`, `cors`, `content-type` and `raw-body`) for you;
with Yarn, add them yourself. The optional ones turn on features:

| Install                                                                          | To                                            |
| -------------------------------------------------------------------------------- | --------------------------------------------- |
| `@frontmcp/storage-sqlite`                                                       | Keep sessions, tasks and events in SQLite     |
| `@frontmcp/observability`, `@opentelemetry/api`, `@opentelemetry/sdk-trace-base` | Trace and log requests with OpenTelemetry     |
| `openai` or `@anthropic-ai/sdk`                                                  | Run an `@Agent` on OpenAI or Anthropic models |
| `@enclave-vm/core`                                                               | Run dynamic jobs (scripts) in a sandbox       |

## A server in one file

```ts
import 'reflect-metadata';

import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'add',
  description: 'Add two numbers',
  inputSchema: { a: z.number(), b: z.number() },
})
class AddTool extends ToolContext {
  async execute(input: { a: number; b: number }) {
    return input.a + input.b;
  }
}

@App({ id: 'calc', name: 'Calculator', tools: [AddTool] })
class CalcApp {}

@FrontMcp({
  info: { name: 'Demo', version: '0.1.0' },
  apps: [CalcApp],
  http: { port: 3000, entryPath: '/mcp' },
})
export default class Server {}
```

Save it as `src/main.ts` and run `npx frontmcp dev`. The server reloads when you edit it, and answers MCP requests at
`http://localhost:3000/mcp` (at `/` without `entryPath`). Try it with the MCP Inspector, `npx frontmcp inspector`, or
add it to Claude Code:

```bash
claude mcp add --transport http demo http://localhost:3000/mcp
```

A tool is a class: `@Tool` describes it to the model, `inputSchema` validates its input with [Zod](https://zod.dev)
(the SDK exports `z`), and `execute` returns the result. An `@App` groups tools, resources, prompts and providers, and
`@FrontMcp` is the server. The [Quick Start](https://frontmcp.dev/learn) walks through each piece.

## What the SDK covers

| Area                 | What you use                                                                                                                         | Docs                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Server and apps      | `@FrontMcp`, `@App`                                                                                                                  | [Server][docs-frontmcp], [Apps][docs-app]                                                    |
| What clients call    | `@Tool`, `@Resource`, `@ResourceTemplate`, `@Prompt`, `@Skill`                                                                       | [Tools][docs-tool], [Resources][docs-resource], [Prompts][docs-prompt], [Skills][docs-skill] |
| Work that takes time | `@Agent`, `@Job`, `@Workflow`, background tasks                                                                                      | [Agents][docs-agent], [Jobs][docs-job], [Workflows][docs-workflow], [Tasks][docs-tasks]      |
| Your own code        | `@Provider` (dependency injection), hooks, `@Plugin`, `@Adapter`                                                                     | [Providers][docs-provider], [Hooks][docs-hooks], [Plugins][docs-plugins]                     |
| Who may call         | Auth modes (public, static keys, transparent JWT, local or remote OAuth), sessions, authorities                                      | [Authentication][docs-auth]                                                                  |
| Protocol             | Every MCP revision from `2024-11-05` to `2026-07-28` on one endpoint, chosen per request                                             | [Protocol versions][docs-protocol]                                                           |
| Running it           | Streamable HTTP or stdio; in process with `create()`; as tools for OpenAI, Claude, LangChain and the Vercel AI SDK with `connect*()` | [Deployment][docs-deploy], [`create()`][docs-create], [`connect()`][docs-connect]            |

The [SDK reference](https://frontmcp.dev/reference/sdk) lists every decorator, context method and option.

## Related packages

- [`frontmcp`](https://www.npmjs.com/package/frontmcp) — the CLI: `create`, `dev`, `build`, `test`
- [`@frontmcp/testing`](https://www.npmjs.com/package/@frontmcp/testing) — end-to-end tests for a server
- [`@frontmcp/adapters`](https://www.npmjs.com/package/@frontmcp/adapters) — generate tools from an OpenAPI spec
- [`@frontmcp/auth`](https://www.npmjs.com/package/@frontmcp/auth) — the authentication layer the SDK uses
- Plugins: [`@frontmcp/plugin-cache`](https://www.npmjs.com/package/@frontmcp/plugin-cache),
  [`@frontmcp/plugin-remember`](https://www.npmjs.com/package/@frontmcp/plugin-remember),
  [`@frontmcp/plugin-approval`](https://www.npmjs.com/package/@frontmcp/plugin-approval),
  [`@frontmcp/plugin-codecall`](https://www.npmjs.com/package/@frontmcp/plugin-codecall) and
  [more](https://frontmcp.dev/reference/plugins)
- [`@frontmcp/ui`](https://www.npmjs.com/package/@frontmcp/ui) and
  [`@frontmcp/react`](https://www.npmjs.com/package/@frontmcp/react) — widgets for tool results, and React hooks for a
  FrontMCP server

Keep every `@frontmcp/*` package on the same version: they depend on each other at exact versions.

## Contributing

Source: [`libs/sdk`](https://github.com/agentfront/frontmcp/tree/main/libs/sdk). Issues and pull requests are welcome;
see [CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).

<!-- links -->

[docs-frontmcp]: https://frontmcp.dev/reference/sdk/frontmcp
[docs-app]: https://frontmcp.dev/reference/sdk/app
[docs-tool]: https://frontmcp.dev/reference/sdk/tool
[docs-resource]: https://frontmcp.dev/reference/sdk/resource
[docs-prompt]: https://frontmcp.dev/reference/sdk/prompt
[docs-skill]: https://frontmcp.dev/reference/sdk/skill
[docs-agent]: https://frontmcp.dev/reference/sdk/agent
[docs-job]: https://frontmcp.dev/reference/sdk/job
[docs-workflow]: https://frontmcp.dev/reference/sdk/workflow
[docs-tasks]: https://frontmcp.dev/reference/server/tasks
[docs-provider]: https://frontmcp.dev/reference/sdk/provider
[docs-hooks]: https://frontmcp.dev/reference/sdk/hooks
[docs-plugins]: https://frontmcp.dev/reference/plugins
[docs-auth]: https://frontmcp.dev/reference/auth
[docs-protocol]: https://frontmcp.dev/reference/server/protocol-versions
[docs-deploy]: https://frontmcp.dev/reference/deployment
[docs-create]: https://frontmcp.dev/reference/sdk/create
[docs-connect]: https://frontmcp.dev/reference/sdk/connect
