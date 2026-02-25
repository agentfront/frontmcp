# @frontmcp/nx

[![npm version](https://img.shields.io/npm/v/@frontmcp/nx.svg)](https://www.npmjs.com/package/@frontmcp/nx)
[![License](https://img.shields.io/npm/l/@frontmcp/nx.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

> Nx plugin for FrontMCP — generators and executors for building MCP servers.

## Installation

```bash
npm install -D @frontmcp/nx
```

## Generators

| Generator       | Command                           | Description                                                                      |
| --------------- | --------------------------------- | -------------------------------------------------------------------------------- |
| `workspace`     | `nx g @frontmcp/nx:workspace`     | Scaffold a full FrontMCP Nx monorepo with apps/, libs/, and servers/ directories |
| `app`           | `nx g @frontmcp/nx:app`           | Generate a FrontMCP application in apps/                                         |
| `lib`           | `nx g @frontmcp/nx:lib`           | Generate a shared library in libs/                                               |
| `server`        | `nx g @frontmcp/nx:server`        | Generate a deployment shell in servers/                                          |
| `tool`          | `nx g @frontmcp/nx:tool`          | Generate a @Tool class                                                           |
| `resource`      | `nx g @frontmcp/nx:resource`      | Generate a @Resource or @ResourceTemplate class                                  |
| `prompt`        | `nx g @frontmcp/nx:prompt`        | Generate a @Prompt class                                                         |
| `skill`         | `nx g @frontmcp/nx:skill`         | Generate a @Skill class                                                          |
| `agent`         | `nx g @frontmcp/nx:agent`         | Generate an @Agent class                                                         |
| `provider`      | `nx g @frontmcp/nx:provider`      | Generate a @Provider class for dependency injection                              |
| `plugin`        | `nx g @frontmcp/nx:plugin`        | Generate a @Plugin class extending DynamicPlugin                                 |
| `adapter`       | `nx g @frontmcp/nx:adapter`       | Generate an @Adapter class extending DynamicAdapter                              |
| `auth-provider` | `nx g @frontmcp/nx:auth-provider` | Generate an @AuthProvider class                                                  |
| `flow`          | `nx g @frontmcp/nx:flow`          | Generate a @Flow class extending FlowBase                                        |
| `job`           | `nx g @frontmcp/nx:job`           | Generate a @Job class                                                            |
| `workflow`      | `nx g @frontmcp/nx:workflow`      | Generate a @Workflow class                                                       |

## Executors

| Executor     | Description                                                 |
| ------------ | ----------------------------------------------------------- |
| `build`      | Compile a FrontMCP project using `frontmcp build`           |
| `build-exec` | Build a distributable bundle using `frontmcp build --exec`  |
| `dev`        | Start a development server using `frontmcp dev`             |
| `serve`      | Start a supervised production server using `frontmcp start` |
| `test`       | Run E2E tests using `frontmcp test`                         |
| `inspector`  | Launch MCP Inspector using `frontmcp inspector`             |
| `deploy`     | Deploy to a target platform (node/vercel/lambda/cloudflare) |

## Quick Start

### Create a new application

```bash
nx g @frontmcp/nx:app my-server
```

### Add a tool

```bash
nx g @frontmcp/nx:tool search --project=my-server
```

### Add a resource

```bash
nx g @frontmcp/nx:resource config --project=my-server
```

### Build and serve

```bash
nx build my-server
nx serve my-server
```

## Related Packages

- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk) — Core FrontMCP SDK
- [`@frontmcp/cli`](https://www.npmjs.com/package/@frontmcp/cli) — FrontMCP CLI
- [`@frontmcp/adapters`](https://www.npmjs.com/package/@frontmcp/adapters) — Framework adapters
- [`@frontmcp/plugins`](https://www.npmjs.com/package/@frontmcp/plugins) — Plugin system

## License

Apache-2.0
