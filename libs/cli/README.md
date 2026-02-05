# @frontmcp/cli

Command-line interface for scaffolding and managing FrontMCP server projects.

[![NPM](https://img.shields.io/npm/v/frontmcp.svg)](https://www.npmjs.com/package/frontmcp)

## Install

```bash
npm install -g frontmcp
# or use directly
npx frontmcp create my-app
```

## Commands

| Command                  | Description                                |
| ------------------------ | ------------------------------------------ |
| `frontmcp create [name]` | Scaffold a new FrontMCP project            |
| `frontmcp init`          | Initialize FrontMCP in an existing project |
| `frontmcp dev`           | Start development server with hot reload   |
| `frontmcp build`         | Build for production                       |
| `frontmcp inspector`     | Launch MCP Inspector UI                    |
| `frontmcp doctor`        | Check environment and configuration        |
| `frontmcp test`          | Run E2E tests with `@frontmcp/testing`     |

### `create` Flags

| Flag                   | Description                                          | Default  |
| ---------------------- | ---------------------------------------------------- | -------- |
| `--yes`, `-y`          | Skip prompts, use defaults                           | `false`  |
| `--target <type>`      | Deployment: `node`, `vercel`, `lambda`, `cloudflare` | `node`   |
| `--redis <type>`       | Redis setup: `docker`, `upstash`, `none`             | `docker` |
| `--cicd` / `--no-cicd` | Enable/disable GitHub Actions                        | `true`   |

## Quick Example

```bash
# Interactive — prompts for deployment target, Redis, CI/CD
npx frontmcp create my-app

# Non-interactive — all defaults
npx frontmcp create my-app --yes

# Vercel target, no Redis
npx frontmcp create my-app --target vercel --redis none
```

> Full setup guide: [Installation][docs-install]

## Docs

| Topic                | Link                                |
| -------------------- | ----------------------------------- |
| Installation & setup | [Installation][docs-install]        |
| Local development    | [Local Dev Server][docs-dev]        |
| Production builds    | [Production Build][docs-production] |

## Related Packages

- [`@frontmcp/sdk`](../sdk) — core framework
- [`@frontmcp/testing`](../testing) — E2E testing (used by `frontmcp test`)

## License

Apache-2.0 — see [LICENSE](../../LICENSE).

<!-- links -->

[docs-install]: https://docs.agentfront.dev/frontmcp/getting-started/installation
[docs-dev]: https://docs.agentfront.dev/frontmcp/deployment/local-dev-server
[docs-production]: https://docs.agentfront.dev/frontmcp/deployment/production-build
