<div align="center">

# @frontmcp/sdk

**Build production-grade [MCP](https://modelcontextprotocol.io) servers in TypeScript — decorators, DI, and Streamable HTTP, batteries included.**

[![npm](https://img.shields.io/npm/v/@frontmcp/sdk.svg)](https://www.npmjs.com/package/@frontmcp/sdk)
[![node](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/@frontmcp/sdk.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

[Docs][docs-home] &bull; [Quickstart][docs-quickstart] &bull; [SDK Reference][docs-sdk-ref]

</div>

---

FrontMCP turns the Model Context Protocol into a typed, declarative framework. You
write `@Tool`, `@Resource`, and `@App` classes; the SDK handles the protocol,
transport, sessions, auth, dependency injection, and execution flow — so the same
server runs on your laptop and ships to production unchanged.

## Install

```bash
npx frontmcp create my-app      # scaffold a new project (recommended)
# …or add to an existing one:
npm install @frontmcp/sdk
```

Requires **Node.js 24+**. Full guide → [Installation][docs-install].

## Quick example

```ts
import 'reflect-metadata';

import { z } from 'zod';

import { App, FrontMcp, Tool, ToolContext } from '@frontmcp/sdk';

@Tool({ name: 'greet', inputSchema: { name: z.string() } })
class GreetTool extends ToolContext {
  async execute({ name }: { name: string }) {
    return `Hello, ${name}!`;
  }
}

@App({ id: 'hello', name: 'Hello', tools: [GreetTool] })
class HelloApp {}

@FrontMcp({ info: { name: 'Demo', version: '0.1.0' }, apps: [HelloApp], http: { port: 3000 } })
export default class Server {}
```

Run `npm run dev` and point any MCP client at it. Full walkthrough → [Quickstart][docs-quickstart].

## What you get

- **Build** — `@FrontMcp` server, `@App` domains, and typed `@Tool` / `@Resource` /
  `@Prompt` primitives with Zod schemas; `@Agent` multi-step chains and `@Provider`
  dependency injection.
  &nbsp;([Tools][docs-tools] · [Resources][docs-resources] · [Prompts][docs-prompts] · [Agents][docs-agents] · [Providers][docs-providers])
- **Secure** — Remote & Local OAuth, JWKS, Dynamic Client Registration, per-app auth,
  and stateful / stateless sessions.
  &nbsp;([Authentication][docs-auth])
- **Operate** — Streamable HTTP + SSE transport, capability discovery, elicitation,
  lifecycle hooks, and HTTP-discoverable skill manifests.
  &nbsp;([Transport][docs-transport] · [Discovery][docs-discovery] · [Elicitation][docs-elicitation] · [Hooks][docs-hooks] · [Skills][docs-skills])
- **Extend & embed** — plugins (Cache, Remember, CodeCall, Dashboard), the OpenAPI
  adapter, mounting external MCP servers as sub-apps, and an in-process Direct Client
  (`connectOpenAI` / `connectClaude` / `connectLangChain`).
  &nbsp;([Plugins][docs-plugins] · [Adapters][docs-adapters] · [Ext-Apps][docs-ext-apps] · [Direct Client][docs-direct])
- **Ship anywhere** — one codebase deploys to Node, Vercel, AWS Lambda, Cloudflare
  Workers, or a serverless bundle.
  &nbsp;([Deployment][docs-deploy])

→ Everything is documented at **[docs.agentfront.dev/frontmcp][docs-home]**.

## Related packages

- [`@frontmcp/cli`](../cli) — scaffolding and dev tooling (`frontmcp create`, `dev`, `build`)
- [`@frontmcp/auth`](../auth) — authentication, OAuth, JWKS, credential vault
- [`@frontmcp/adapters`](../adapters) — OpenAPI adapter
- [`@frontmcp/plugins`](../plugins) — Cache, Remember, CodeCall, Dashboard
- [`@frontmcp/testing`](../testing) — E2E testing framework
- [`@frontmcp/ui`](../ui) / [`@frontmcp/uipack`](../uipack) — UI components and build tools

## License

[Apache-2.0](../../LICENSE)

<!-- links -->

[docs-home]: https://docs.agentfront.dev/frontmcp 'FrontMCP Docs'
[docs-install]: https://docs.agentfront.dev/frontmcp/getting-started/installation
[docs-quickstart]: https://docs.agentfront.dev/frontmcp/getting-started/quickstart
[docs-sdk-ref]: https://docs.agentfront.dev/frontmcp/sdk-reference/overview
[docs-tools]: https://docs.agentfront.dev/frontmcp/servers/tools
[docs-resources]: https://docs.agentfront.dev/frontmcp/servers/resources
[docs-prompts]: https://docs.agentfront.dev/frontmcp/servers/prompts
[docs-agents]: https://docs.agentfront.dev/frontmcp/servers/agents
[docs-providers]: https://docs.agentfront.dev/frontmcp/extensibility/providers
[docs-auth]: https://docs.agentfront.dev/frontmcp/authentication/overview
[docs-transport]: https://docs.agentfront.dev/frontmcp/deployment/transport
[docs-discovery]: https://docs.agentfront.dev/frontmcp/servers/discovery
[docs-elicitation]: https://docs.agentfront.dev/frontmcp/servers/elicitation
[docs-hooks]: https://docs.agentfront.dev/frontmcp/extensibility/hooks
[docs-skills]: https://docs.agentfront.dev/frontmcp/servers/skills
[docs-plugins]: https://docs.agentfront.dev/frontmcp/plugins/overview
[docs-adapters]: https://docs.agentfront.dev/frontmcp/adapters/overview
[docs-ext-apps]: https://docs.agentfront.dev/frontmcp/servers/ext-apps
[docs-direct]: https://docs.agentfront.dev/frontmcp/deployment/direct-client
[docs-deploy]: https://docs.agentfront.dev/frontmcp/deployment/local-dev-server
