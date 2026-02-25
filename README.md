<div align="center">

<picture>
  <source width="400" media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/agentfront/frontmcp/refs/heads/main/docs/assets/logo/frontmcp.dark.svg">
  <source width="400" media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/agentfront/frontmcp/refs/heads/main/docs/assets/logo/frontmcp.light.svg">
  <img width="400" alt="FrontMCP Logo" src="https://raw.githubusercontent.com/agentfront/frontmcp/refs/heads/main/docs/assets/logo/frontmcp.light.svg">
</picture>
<hr>

**The TypeScript way to build MCP servers with decorators, DI, and Streamable HTTP.**

[![NPM - @frontmcp/sdk](https://img.shields.io/npm/v/@frontmcp/sdk.svg?v=2)](https://www.npmjs.com/package/@frontmcp/sdk)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/github/license/agentfront/frontmcp.svg?v=1)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)
[![Snyk](https://snyk.io/test/github/agentfront/frontmcp/badge.svg)](https://snyk.io/test/github/agentfront/frontmcp)

[Docs][docs-home] &bull; [Quickstart][docs-quickstart] &bull; [API Reference][docs-sdk-ref] &bull; [Discord](https://discord.gg/frontmcp)

</div>

---

FrontMCP is a **TypeScript-first framework** for the [Model Context Protocol (MCP)](https://modelcontextprotocol.io).
You write clean, typed code; FrontMCP handles the protocol, transport, DI, session/auth, and execution flow.

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

## Installation

**Node.js 22+** required (24 recommended).

```bash
# New project (recommended)
npx frontmcp create my-app

# Existing project
npm i -D frontmcp @types/node@^22
npx frontmcp init
```

> Full setup guide: [Installation][docs-install]

## Capabilities

| Capability           | Description                                                                     | Docs                            |
| -------------------- | ------------------------------------------------------------------------------- | ------------------------------- |
| **@FrontMcp Server** | Decorator-configured server with info, apps, HTTP, logging, session, auth       | [Server][docs-server]           |
| **@App**             | Organizational units grouping tools, resources, prompts with optional isolation | [Apps][docs-apps]               |
| **@Tool**            | Typed actions with Zod schemas — class or function style                        | [Tools][docs-tools]             |
| **@Resource**        | Read-only data exposure with static and template URIs                           | [Resources][docs-resources]     |
| **@Prompt**          | Reusable message templates returning `GetPromptResult`                          | [Prompts][docs-prompts]         |
| **@Agent**           | Orchestrated multi-step tool chains                                             | [Agents][docs-agents]           |
| **Elicitation**      | Request structured user input mid-flow                                          | [Elicitation][docs-elicitation] |
| **Skills**           | HTTP-discoverable tool manifests for agent marketplaces                         | [Skills][docs-skills]           |
| **Discovery**        | Automatic capability advertisement for MCP clients                              | [Discovery][docs-discovery]     |
| **Authentication**   | Remote OAuth, Local OAuth, JWKS, DCR, per-app auth                              | [Authentication][docs-auth]     |
| **Sessions**         | Stateful/stateless session modes with JWT or UUID transport IDs                 | [Server][docs-server]           |
| **Direct Client**    | In-process `create()`, `connect()`, `connectOpenAI()`, `connectClaude()`        | [Direct Client][docs-direct]    |
| **Transport**        | Streamable HTTP + SSE with session headers                                      | [Transport][docs-transport]     |
| **Ext-Apps**         | Mount external MCP servers as sub-apps                                          | [Ext-Apps][docs-ext-apps]       |
| **Hooks**            | 5 hook families: tool, list-tools, HTTP, resource, prompt                       | [Hooks][docs-hooks]             |
| **Providers / DI**   | Scoped dependency injection with GLOBAL and CONTEXT scopes                      | [Providers][docs-providers]     |
| **Plugins**          | Cache, Remember, CodeCall, Dashboard — or build your own                        | [Plugins][docs-plugins]         |
| **Adapters**         | Generate tools from OpenAPI specs                                               | [Adapters][docs-adapters]       |
| **Testing**          | E2E fixtures, matchers, HTTP mocking for MCP servers                            | [Testing][docs-testing]         |
| **UI Library**       | HTML/React widgets, SSR, MCP Bridge, web components                             | [UI][docs-ui]                   |
| **CLI**              | `create`, `init`, `dev`, `build`, `inspector`, `doctor`                         | [CLI][docs-install]             |
| **Deployment**       | Local dev, production builds, version alignment                                 | [Deployment][docs-deploy]       |

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
