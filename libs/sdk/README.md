# @frontmcp/sdk

The core FrontMCP framework for building MCP servers and clients in TypeScript.

[![NPM](https://img.shields.io/npm/v/@frontmcp/sdk.svg)](https://www.npmjs.com/package/@frontmcp/sdk)

## Install

```bash
npm install @frontmcp/sdk
```

> Most users should scaffold with `npx frontmcp create my-app` instead of installing manually. See [Installation][docs-install].

## Features

- **`@FrontMcp` server** — single decorator configures info, apps, HTTP, logging, session, auth ([docs][docs-server])
- **`@App`** — group tools, resources, prompts into isolated domains ([docs][docs-apps])
- **`@Tool`** — typed actions with Zod input schemas, class or function style ([docs][docs-tools])
- **`@Resource`** — read-only data with static and template URIs ([docs][docs-resources])
- **`@Prompt`** — reusable message templates returning `GetPromptResult` ([docs][docs-prompts])
- **`@Agent`** — orchestrated multi-step tool chains ([docs][docs-agents])
- **Elicitation** — request structured user input mid-flow ([docs][docs-elicitation])
- **Skills** — HTTP-discoverable tool manifests for agent marketplaces ([docs][docs-skills])
- **5 context classes** — `ToolContext`, `ResourceContext`, `PromptContext`, `AgentContext`, `HookContext`
- **Direct client** — `create()`, `connect()`, `connectOpenAI()`, `connectClaude()`, `connectLangChain()`, `connectVercelAI()` ([docs][docs-direct])
- **Authentication** — Remote OAuth, Local OAuth, JWKS, DCR, per-app auth surfaces ([docs][docs-auth])
- **Sessions** — stateful / stateless modes, JWT or UUID transport IDs
- **Hooks** — tool, list-tools, HTTP, resource, prompt hook families ([docs][docs-hooks])
- **Ext-Apps** — mount external MCP servers as sub-apps ([docs][docs-ext-apps])
- **Providers / DI** — scoped injection with GLOBAL and CONTEXT scopes ([docs][docs-providers])
- **ConfigPlugin** — load `frontmcp.yaml` / `frontmcp.json` config files ([docs][docs-config])
- **Transport** — Streamable HTTP + SSE ([docs][docs-transport])

## Quick Example

```ts
import 'reflect-metadata';
import { FrontMcp, App, Tool } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({ name: 'greet', inputSchema: { name: z.string() } })
class GreetTool {
  async execute({ name }: { name: string }) {
    return `Hello, ${name}!`;
  }
}

@App({ id: 'hello', name: 'Hello', tools: [GreetTool] })
class HelloApp {}

@FrontMcp({ info: { name: 'Demo', version: '0.1.0' }, apps: [HelloApp], http: { port: 3000 } })
export default class Server {}
```

> Full walkthrough: [Quickstart][docs-quickstart]

## Docs

| Topic                     | Link                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| Server configuration      | [The FrontMCP Server][docs-server]                                                                 |
| Apps & isolation          | [Apps][docs-apps]                                                                                  |
| Tools, Resources, Prompts | [Tools][docs-tools] &middot; [Resources][docs-resources] &middot; [Prompts][docs-prompts]          |
| Agents                    | [Agents][docs-agents]                                                                              |
| Authentication            | [Auth Overview][docs-auth] &middot; [Remote OAuth][docs-remote] &middot; [Local OAuth][docs-local] |
| Direct client             | [Direct Client][docs-direct]                                                                       |
| Hooks & providers         | [Hooks][docs-hooks] &middot; [Providers][docs-providers]                                           |
| Deployment                | [Local Dev][docs-deploy] &middot; [Production][docs-production]                                    |
| SDK reference             | [Overview][docs-sdk-ref]                                                                           |

## Related Packages

- [`@frontmcp/cli`](../cli) — scaffolding and dev tooling
- [`@frontmcp/auth`](../auth) — authentication library
- [`@frontmcp/adapters`](../adapters) — OpenAPI adapter
- [`@frontmcp/plugins`](../plugins) — Cache, Remember, CodeCall, Dashboard
- [`@frontmcp/testing`](../testing) — E2E testing framework
- [`@frontmcp/ui`](../ui) / [`@frontmcp/uipack`](../uipack) — UI components and build tools

## License

Apache-2.0 — see [LICENSE](../../LICENSE).

<!-- links -->

[docs-install]: https://docs.agentfront.dev/frontmcp/getting-started/installation
[docs-quickstart]: https://docs.agentfront.dev/frontmcp/getting-started/quickstart
[docs-server]: https://docs.agentfront.dev/frontmcp/servers/server
[docs-apps]: https://docs.agentfront.dev/frontmcp/servers/apps
[docs-tools]: https://docs.agentfront.dev/frontmcp/servers/tools
[docs-resources]: https://docs.agentfront.dev/frontmcp/servers/resources
[docs-prompts]: https://docs.agentfront.dev/frontmcp/servers/prompts
[docs-agents]: https://docs.agentfront.dev/frontmcp/servers/agents
[docs-elicitation]: https://docs.agentfront.dev/frontmcp/servers/elicitation
[docs-skills]: https://docs.agentfront.dev/frontmcp/servers/skills
[docs-auth]: https://docs.agentfront.dev/frontmcp/authentication/overview
[docs-remote]: https://docs.agentfront.dev/frontmcp/authentication/remote
[docs-local]: https://docs.agentfront.dev/frontmcp/authentication/local
[docs-direct]: https://docs.agentfront.dev/frontmcp/deployment/direct-client
[docs-transport]: https://docs.agentfront.dev/frontmcp/deployment/transport
[docs-ext-apps]: https://docs.agentfront.dev/frontmcp/servers/ext-apps
[docs-hooks]: https://docs.agentfront.dev/frontmcp/extensibility/hooks
[docs-providers]: https://docs.agentfront.dev/frontmcp/extensibility/providers
[docs-config]: https://docs.agentfront.dev/frontmcp/extensibility/config-yaml
[docs-deploy]: https://docs.agentfront.dev/frontmcp/deployment/local-dev-server
[docs-production]: https://docs.agentfront.dev/frontmcp/deployment/production-build
[docs-sdk-ref]: https://docs.agentfront.dev/frontmcp/sdk-reference/overview
