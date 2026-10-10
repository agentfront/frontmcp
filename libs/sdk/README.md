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
- **Speak every MCP revision** — `2024-11-05` through `2026-07-28` on one endpoint,
  selected per request. The 2026 revision is stateless (no `initialize`, no session):
  `server/discover`, mirrored request headers, Multi Round-Trip Requests, the tasks
  extension, and `subscriptions/listen` are all built in, and older clients keep
  working unchanged.
  &nbsp;([Protocol Versions][docs-protocol])
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

→ Everything is documented at **[frontmcp.dev][docs-home]**.

## Related packages

- [`frontmcp`](../cli) — the CLI: scaffolding and dev tooling (`frontmcp create`, `dev`, `build`)
- [`@frontmcp/auth`](../auth) — authentication, OAuth, JWKS, credential vault
- [`@frontmcp/adapters`](../adapters) — OpenAPI adapter
- [`@frontmcp/plugins`](../plugins) — Cache, Remember, CodeCall, Dashboard
- [`@frontmcp/testing`](../testing) — E2E testing framework
- [`@frontmcp/ui`](../ui) / [`@frontmcp/uipack`](../uipack) — UI components and build tools

## License

[Apache-2.0](../../LICENSE)

<!-- links -->

[docs-home]: https://frontmcp.dev/ 'FrontMCP Docs'
[docs-install]: https://frontmcp.dev/learn/installation
[docs-quickstart]: https://frontmcp.dev/learn
[docs-sdk-ref]: https://frontmcp.dev/reference/sdk#decorators
[docs-tools]: https://frontmcp.dev/reference/sdk/tool
[docs-resources]: https://frontmcp.dev/reference/sdk/resource
[docs-prompts]: https://frontmcp.dev/reference/sdk/prompt
[docs-agents]: https://frontmcp.dev/reference/sdk/agent
[docs-providers]: https://frontmcp.dev/reference/sdk/provider
[docs-auth]: https://frontmcp.dev/reference/auth
[docs-transport]: https://frontmcp.dev/reference/deployment/security
[docs-protocol]: https://frontmcp.dev/reference/server/protocol-versions 'Protocol Versions'
[docs-discovery]: https://frontmcp.dev/reference/server/apps#what-clients-see
[docs-elicitation]: https://frontmcp.dev/reference/sdk/elicit
[docs-hooks]: https://frontmcp.dev/reference/sdk/hooks
[docs-skills]: https://frontmcp.dev/reference/sdk/skill
[docs-plugins]: https://frontmcp.dev/reference/plugins
[docs-adapters]: https://frontmcp.dev/reference/sdk/adapter
[docs-ext-apps]: https://frontmcp.dev/learn/your-first-widget
[docs-direct]: https://frontmcp.dev/reference/sdk/connect
[docs-deploy]: https://frontmcp.dev/reference/cli#frontmcp-dev
