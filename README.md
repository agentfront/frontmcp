<div align="center">

<a href="https://frontmcp.dev">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/readme/hero.svg">
  <img src=".github/assets/readme/hero.light.svg" alt="FrontMCP - The TypeScript way to build MCP servers" width="100%">
</picture>
</a>

[![NPM](https://img.shields.io/npm/v/@frontmcp/sdk.svg?style=flat-square&color=16A34A&labelColor=0b1117&label=npm)](https://www.npmjs.com/package/@frontmcp/sdk)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2024-16A34A?style=flat-square&labelColor=0b1117&logo=node.js&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/github/license/agentfront/frontmcp.svg?style=flat-square&color=16A34A&labelColor=0b1117)](./LICENSE)
[![Snyk](https://img.shields.io/badge/snyk-monitored-16A34A?style=flat-square&labelColor=0b1117&logo=snyk&logoColor=white)](https://snyk.io/test/github/agentfront/frontmcp)
[![Discord](https://img.shields.io/badge/discord-join-16A34A?style=flat-square&labelColor=0b1117&logo=discord&logoColor=white)](https://discord.gg/53AHnJnmwR)

**[frontmcp.dev](https://frontmcp.dev)** &nbsp;&middot;&nbsp; **[Learn][docs-learn]** &nbsp;&middot;&nbsp; **[Reference][docs-reference]** &nbsp;&middot;&nbsp; **[Examples][docs-examples]** &nbsp;&middot;&nbsp; **[Playground][docs-playground]** &nbsp;&middot;&nbsp; **[Blog][docs-blog]**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/readme/terminal.svg">
  <img src=".github/assets/readme/terminal.light.svg" alt="npx frontmcp create my-app, then npm run dev: an MCP server running on localhost:3000" width="760">
</picture>

</div>

<br>

## Write a tool. Ship a server.

Classes in, protocol out. FrontMCP handles transport, DI, sessions, auth and execution flow, and the same server runs locally and in production unchanged.

```ts
import 'reflect-metadata';

import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'add',
  description: 'Adds two numbers together',
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
  http: { port: 3000 },
})
export default class Server {}
```

<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/readme/features.svg">
  <img src=".github/assets/readme/features.light.svg" alt="Typed end to end, auth built in, ship anywhere, every stage is a hook, tools with a face, one endpoint for any client" width="100%">
</picture>
</div>

<br>

## Start

```bash
npx frontmcp create my-app        # new project (Node 24+)
npx frontmcp init                 # or add FrontMCP to an existing one
```

Then follow **[Learn][docs-learn]** on [frontmcp.dev](https://frontmcp.dev), or browse [Tools][docs-tools], [Resources][docs-resources], [Prompts][docs-prompts], [Agents][docs-agents], [Auth][docs-auth], [Plugins][docs-plugins], [Tool UI][docs-ext-apps], [Testing][docs-testing] and [Deployment][docs-deploy]. Try it live in the [Playground][docs-playground].

## Packages

Install `frontmcp` (CLI) and `@frontmcp/sdk`. The rest is pulled in for you, or opt-in. Keep every `@frontmcp/*` package on the same version; a mismatch fails fast at boot ([why][docs-production]).

<details>
<summary><b>Core and extensions</b></summary>
<br>

| Package                                             | What it does                                                    |
| --------------------------------------------------- | --------------------------------------------------------------- |
| [`frontmcp`](libs/cli)                              | CLI: `create`, `init`, `dev`, `build`, `inspect`, `doctor`      |
| [`@frontmcp/sdk`](libs/sdk)                         | Core framework: decorators, DI, flows, transport, MCP protocol  |
| [`@frontmcp/auth`](libs/auth)                       | OAuth, JWKS, DCR/CIMD, sessions, credential vault               |
| [`@frontmcp/testing`](libs/testing)                 | E2E test framework with fixtures and matchers                   |
| [`@frontmcp/adapters`](libs/adapters)               | Generate tools from an OpenAPI spec                             |
| [`@frontmcp/skills`](libs/skills)                   | Curated `SKILL.md` catalog for scaffolding and `skills install` |
| [`@frontmcp/guard`](libs/guard)                     | Rate limits, concurrency and policy guards                      |
| [`@frontmcp/observability`](libs/observability)     | Structured logging, metrics and tracing                         |
| [`@frontmcp/react`](libs/react)                     | React hooks and client for a FrontMCP server                    |
| [`@frontmcp/ui`](libs/ui) / [`uipack`](libs/uipack) | Widgets, SSR renderers, MCP Bridge, themes                      |
| [`@frontmcp/edge`](libs/edge)                       | Run a server on Cloudflare Workers / V8 isolates                |
| [`@frontmcp/storage-sqlite`](libs/storage-sqlite)   | SQLite session, task and elicitation stores                     |
| [`@frontmcp/nx`](libs/nx-plugin)                    | Nx generators and executors                                     |

Internal, published so the above resolve: [`protocol`](libs/protocol), [`di`](libs/di), [`utils`](libs/utils), [`lazy-zod`](libs/lazy-zod).

</details>

<details>
<summary><b>Official plugins</b></summary>
<br>

| Package                                                              | What it does                                    |
| -------------------------------------------------------------------- | ----------------------------------------------- |
| [`@frontmcp/plugin-cache`](plugins/plugin-cache)                     | Cache tool results with a TTL                   |
| [`@frontmcp/plugin-remember`](plugins/plugin-remember)               | Per-session memory (`this.remember`)            |
| [`@frontmcp/plugin-approval`](plugins/plugin-approval)               | Human approval gates before a tool runs         |
| [`@frontmcp/plugin-codecall`](plugins/plugin-codecall)               | Let the model compose tool calls as code        |
| [`@frontmcp/plugin-dashboard`](plugins/plugin-dashboard)             | Built-in web dashboard                          |
| [`@frontmcp/plugin-feature-flags`](plugins/plugin-feature-flags)     | Toggle tools and apps at runtime                |
| [`@frontmcp/plugin-skilled-openapi`](plugins/plugin-skilled-openapi) | OpenAPI to skills and meta-tools for big APIs   |
| [`@frontmcp/plugin-webmcp`](plugins/plugin-webmcp)                   | Expose in-page tools to browser agents (WebMCP) |

</details>

<br>

<div align="center">

PRs welcome: see [CONTRIBUTING](./CONTRIBUTING.md). Released under the [Apache-2.0](./LICENSE) license.

</div>

<!-- docs links -->

[docs-learn]: https://frontmcp.dev/learn 'Learn FrontMCP'
[docs-reference]: https://frontmcp.dev/reference 'Reference'
[docs-examples]: https://frontmcp.dev/examples 'Examples'
[docs-playground]: https://frontmcp.dev/playground 'Playground'
[docs-blog]: https://frontmcp.dev/blog 'Blog'
[docs-tools]: https://frontmcp.dev/reference/sdk/tool 'Tools'
[docs-resources]: https://frontmcp.dev/reference/sdk/resource 'Resources'
[docs-prompts]: https://frontmcp.dev/reference/sdk/prompt 'Prompts'
[docs-agents]: https://frontmcp.dev/reference/sdk/agent 'Agents'
[docs-auth]: https://frontmcp.dev/reference/auth/modes 'Authentication'
[docs-ext-apps]: https://frontmcp.dev/learn/tools-with-a-ui 'Tool UI / MCP Apps'
[docs-plugins]: https://frontmcp.dev/reference/plugins 'Plugins'
[docs-testing]: https://frontmcp.dev/reference/testing 'Testing'
[docs-deploy]: https://frontmcp.dev/reference/deployment/node 'Deployment'
[docs-production]: https://frontmcp.dev/reference/deployment/production-build 'Production Build'
