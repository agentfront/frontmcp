<div align="center">

<picture>
  <source width="400" media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/agentfront/frontmcp/refs/heads/main/docs/assets/logo/frontmcp.dark.svg">
  <source width="400" media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/agentfront/frontmcp/refs/heads/main/docs/assets/logo/frontmcp.light.svg">
  <img width="400" alt="FrontMCP Logo" src="https://raw.githubusercontent.com/agentfront/frontmcp/refs/heads/main/docs/assets/logo/frontmcp.light.svg">
</picture>
<hr>

**The production-grade, TypeScript-first framework for building MCP servers — decorators, DI, auth, and Streamable HTTP, batteries included.**

[![NPM - @frontmcp/sdk](https://img.shields.io/npm/v/@frontmcp/sdk.svg?v=2)](https://www.npmjs.com/package/@frontmcp/sdk)
[![Node](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/github/license/agentfront/frontmcp.svg?v=1)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)
[![Snyk](https://snyk.io/test/github/agentfront/frontmcp/badge.svg)](https://snyk.io/test/github/agentfront/frontmcp)

[Docs][docs-home] &bull; [Quickstart][docs-quickstart] &bull; [API Reference][docs-sdk-ref] &bull; [Discord](https://discord.gg/53AHnJnmwR)

</div>

---

FrontMCP turns the [Model Context Protocol](https://modelcontextprotocol.io) into a
typed, declarative framework. You write clean `@Tool`, `@Resource`, and `@App`
classes; FrontMCP handles the protocol, transport, dependency injection, sessions,
auth, and execution flow — and the **same server runs locally and ships to
production unchanged**.

```ts
import 'reflect-metadata';

import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import HelloApp from './hello.app';

@FrontMcp({
  info: { name: 'Demo', version: '0.1.0' },
  apps: [HelloApp],
  http: { port: 3000 },
  logging: { level: LogLevel.Info },
})
export default class Server {}
```

## Why FrontMCP

- **Typed by default** — decorators + Zod schemas give end-to-end types from input to output, with editor autocomplete and compile-time checks.
- **Batteries included** — auth (OAuth/JWKS/DCR), sessions, transport, discovery, and DI are built in, not bolted on.
- **Ship anywhere** — one codebase deploys to Node, Vercel, AWS Lambda, Cloudflare Workers, or a serverless bundle.
- **Production-minded** — stateful/stateless sessions, high-availability transport, structured observability, and a 95%+ tested core.
- **Extensible** — plugins, lifecycle hooks, OpenAPI adapters, and external MCP sub-apps when you outgrow the defaults.

## Installation

**Node.js 24+** required.

```bash
# New project (recommended)
npx frontmcp create my-app

# Existing project
npm i -D frontmcp @types/node@^24
npx frontmcp init
```

> Full setup guide: [Installation][docs-install] &middot; [Quickstart][docs-quickstart]

## Capabilities

**Build** — decorator-configured [`@FrontMcp` server][docs-server] and [`@App`][docs-apps]
domains; typed [`@Tool`][docs-tools], [`@Resource`][docs-resources], and
[`@Prompt`][docs-prompts] primitives; [`@Agent`][docs-agents] multi-step chains; and
scoped [Providers / DI][docs-providers].

**Secure** — [Remote & Local OAuth, JWKS, DCR, per-app auth][docs-auth] with
stateful / stateless [sessions][docs-server] (JWT or UUID transport IDs).

**Connect & operate** — [Streamable HTTP + SSE transport][docs-transport],
capability [discovery][docs-discovery], [elicitation][docs-elicitation],
[hooks][docs-hooks], HTTP-discoverable [skills][docs-skills],
[external MCP sub-apps][docs-ext-apps], an in-process [Direct Client][docs-direct]
(`connectOpenAI` / `connectClaude`), and first-class [deployment][docs-deploy].

**Extend & tooling** — official [plugins][docs-plugins] (Cache, Remember, CodeCall,
Dashboard), the [OpenAPI adapter][docs-adapters], a [UI library][docs-ui] (HTML/React
widgets, SSR, MCP Bridge), an [E2E testing framework][docs-testing], and a
[CLI][docs-install] (`create`, `init`, `dev`, `build`, `inspect`, `doctor`).

→ Full reference: **[docs.agentfront.dev/frontmcp][docs-home]**

## Packages

| Package                               | Description                                            |
| ------------------------------------- | ------------------------------------------------------ |
| [`@frontmcp/sdk`](libs/sdk)           | Core framework — decorators, DI, flows, transport      |
| [`@frontmcp/cli`](libs/cli)           | CLI tooling (`frontmcp create`, `dev`, `build`)        |
| [`@frontmcp/auth`](libs/auth)         | Authentication, OAuth, JWKS, credential vault          |
| [`@frontmcp/adapters`](libs/adapters) | OpenAPI adapter for auto-generating tools              |
| [`@frontmcp/plugins`](libs/plugins)   | Official plugins: Cache, Remember, CodeCall, Dashboard |
| [`@frontmcp/testing`](libs/testing)   | E2E test framework with fixtures and matchers          |
| [`@frontmcp/ui`](libs/ui)             | React components, hooks, SSR renderers                 |
| [`@frontmcp/uipack`](libs/uipack)     | React-free themes, build tools, platform adapters      |
| [`@frontmcp/di`](libs/di)             | Dependency injection container (internal)              |
| [`@frontmcp/utils`](libs/utils)       | Shared utilities — naming, URI, crypto, FS (internal)  |

## Version Alignment

Keep all `@frontmcp/*` packages on the same version. A clear **"version mismatch"** error is thrown at boot if versions drift. ([Production Build][docs-production])

## Contributing

PRs welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for workflow, coding standards, and the PR checklist.

## License

[Apache-2.0](./LICENSE)

<!-- docs links -->

[docs-home]: https://docs.agentfront.dev/frontmcp 'FrontMCP Docs'
[docs-install]: https://docs.agentfront.dev/frontmcp/getting-started/installation 'Installation'
[docs-quickstart]: https://docs.agentfront.dev/frontmcp/getting-started/quickstart 'Quickstart'
[docs-sdk-ref]: https://docs.agentfront.dev/frontmcp/sdk-reference/overview 'SDK Reference'
[docs-server]: https://docs.agentfront.dev/frontmcp/servers/server 'The FrontMCP Server'
[docs-apps]: https://docs.agentfront.dev/frontmcp/servers/apps 'Apps'
[docs-tools]: https://docs.agentfront.dev/frontmcp/servers/tools 'Tools'
[docs-resources]: https://docs.agentfront.dev/frontmcp/servers/resources 'Resources'
[docs-prompts]: https://docs.agentfront.dev/frontmcp/servers/prompts 'Prompts'
[docs-agents]: https://docs.agentfront.dev/frontmcp/servers/agents 'Agents'
[docs-elicitation]: https://docs.agentfront.dev/frontmcp/servers/elicitation 'Elicitation'
[docs-skills]: https://docs.agentfront.dev/frontmcp/servers/skills 'Skills'
[docs-discovery]: https://docs.agentfront.dev/frontmcp/servers/discovery 'Discovery'
[docs-auth]: https://docs.agentfront.dev/frontmcp/authentication/overview 'Authentication'
[docs-direct]: https://docs.agentfront.dev/frontmcp/deployment/direct-client 'Direct Client'
[docs-transport]: https://docs.agentfront.dev/frontmcp/deployment/transport 'Transport'
[docs-ext-apps]: https://docs.agentfront.dev/frontmcp/servers/ext-apps 'Ext-Apps'
[docs-hooks]: https://docs.agentfront.dev/frontmcp/extensibility/hooks 'Hooks'
[docs-providers]: https://docs.agentfront.dev/frontmcp/extensibility/providers 'Providers'
[docs-plugins]: https://docs.agentfront.dev/frontmcp/plugins/overview 'Plugins'
[docs-adapters]: https://docs.agentfront.dev/frontmcp/adapters/overview 'Adapters'
[docs-testing]: https://docs.agentfront.dev/frontmcp/testing/overview 'Testing'
[docs-ui]: https://docs.agentfront.dev/frontmcp/ui/overview 'UI Library'
[docs-deploy]: https://docs.agentfront.dev/frontmcp/deployment/local-dev-server 'Deployment'
[docs-production]: https://docs.agentfront.dev/frontmcp/deployment/production-build 'Production Build'
