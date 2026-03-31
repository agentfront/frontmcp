---
name: frontmcp-deployment
description: 'Use when you need to deploy, build for production, containerize, or ship a FrontMCP server. Covers Vercel, Lambda, Cloudflare, Docker, edge runtime, serverless, bundle for CLI, and Node targets. Triggers: deploy, build for production, dockerize, serverless, go live.'
tags: [router, deployment, node, vercel, lambda, cloudflare, cli, browser, sdk, guide]
category: deployment
targets: [all]
bundle: [recommended, minimal, full]
priority: 10
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/deployment/runtime-modes
---

# FrontMCP Deployment Router

Entry point for deploying and building FrontMCP servers. This skill helps you choose the right deployment target or build format based on your infrastructure requirements.

## When to Use This Skill

### Must Use

- Choosing between deployment targets (Node vs Vercel vs Lambda vs Cloudflare) for a new project
- Deciding on a build format (server vs CLI vs browser vs SDK) for distribution
- Planning infrastructure and need to understand trade-offs between deployment options

### Recommended

- Comparing serverless platforms for cost, cold-start, and feature support
- Understanding which transport protocol and storage provider each target requires
- Migrating from one deployment target to another

### Skip When

- You already know your deployment target (go directly to `deploy-to-node`, `deploy-to-vercel`, etc.)
- You need to configure server settings, not deploy (see `frontmcp-config`)
- You need to build components, not ship them (see `frontmcp-development`)

> **Decision:** Use this skill when you need to figure out WHERE to deploy. Use the specific skill when you already know.

## Prerequisites

- A working FrontMCP server with at least one `@App` and one `@Tool` (see `frontmcp-development`)
- Server configuration completed (see `frontmcp-config`)
- Tests passing locally (see `frontmcp-testing`)

## Steps

1. Review the Scenario Routing Table and Target Comparison below to choose a deployment target
2. Run `frontmcp build --target <target>` to produce the build output
3. Follow the specific deployment skill (e.g., `deploy-to-node`, `deploy-to-vercel`) for platform instructions
4. Verify with the Post-Deployment checklist at the end of this skill

## Scenario Routing Table

| Scenario                                          | Skill                       | Description                                                             |
| ------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------- |
| Long-running server on VPS, Docker, or bare metal | `deploy-to-node`            | Node.js with stdio or HTTP transport, PM2/Docker for process management |
| Serverless with zero config and Vercel KV         | `deploy-to-vercel`          | Vercel Functions with Streamable HTTP, Vercel KV for storage            |
| AWS serverless with API Gateway                   | `deploy-to-lambda`          | Lambda + API Gateway with Streamable HTTP, DynamoDB or ElastiCache      |
| Edge computing with global distribution           | `deploy-to-cloudflare`      | Cloudflare Workers with KV or Durable Objects for storage               |
| Standalone executable binary for distribution     | `build-for-cli`             | Single-binary CLI with stdio transport, embedded storage                |
| Run MCP in a web browser                          | `build-for-browser`         | Browser-compatible bundle with in-memory transport                      |
| Embed MCP into an existing Node.js application    | `build-for-sdk`             | Library build for programmatic usage without standalone server          |
| Write a Dockerfile for Node.js deployment         | `deploy-to-node-dockerfile` | Dockerfile configuration for Node.js deployment                         |
| Configure Vercel-specific settings (vercel.json)  | `deploy-to-vercel-config`   | Vercel-specific configuration (vercel.json)                             |

### CLI Commands for Deployment and Operations

Beyond `frontmcp build`, the CLI provides commands for the full deployment lifecycle:

| Command                      | Description                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `frontmcp build -t <target>` | Build for target: `node`, `vercel`, `lambda`, `cloudflare`, `cli`, `browser`, `sdk` |
| `frontmcp build -t cli --js` | Build CLI as JS bundle (instead of native binary via SEA)                           |
| `frontmcp start <name>`      | Start a named MCP server with supervisor (process management)                       |
| `frontmcp stop <name>`       | Stop managed server (`-f` for force kill)                                           |
| `frontmcp restart <name>`    | Restart managed server                                                              |
| `frontmcp status [name]`     | Show process status (detail if name given, table if omitted)                        |
| `frontmcp list`              | List all managed processes                                                          |
| `frontmcp logs <name>`       | Tail log output (`-F` follow, `-n` lines)                                           |
| `frontmcp socket <entry>`    | Start Unix socket daemon for local MCP server                                       |
| `frontmcp service <action>`  | Install/uninstall systemd (Linux) or launchd (macOS) service                        |
| `frontmcp install <source>`  | Install MCP app from npm, local path, or git                                        |
| `frontmcp uninstall <name>`  | Remove installed MCP app                                                            |
| `frontmcp configure <name>`  | Re-run setup questionnaire for installed app                                        |
| `frontmcp doctor`            | Check Node.js/npm versions and tsconfig requirements                                |
| `frontmcp inspector`         | Launch MCP Inspector for debugging                                                  |
| `frontmcp init`              | Create or fix tsconfig.json for FrontMCP                                            |

## Target Comparison

| Target     | Transport                   | Storage               | Cold Start | Stateful | Best For                         |
| ---------- | --------------------------- | --------------------- | ---------- | -------- | -------------------------------- |
| Node       | stdio, SSE, Streamable HTTP | Redis, SQLite, memory | None       | Yes      | Full-featured production servers |
| Vercel     | Streamable HTTP (stateless) | Vercel KV             | ~250ms     | No       | Rapid deployment, hobby/startup  |
| Lambda     | Streamable HTTP (stateless) | DynamoDB, ElastiCache | ~500ms     | No       | AWS ecosystem, event-driven      |
| Cloudflare | Streamable HTTP (stateless) | KV, Durable Objects   | ~5ms       | Limited  | Edge-first, global latency       |
| CLI        | stdio                       | SQLite, memory        | None       | Yes      | Desktop tools, local agents      |
| Browser    | In-memory                   | memory                | None       | Yes      | Client-side AI, demos            |
| SDK        | Programmatic                | Configurable          | None       | Yes      | Embedding in existing apps       |

> **Note on storage:** The FrontMCP SDK's `StorageProvider` type supports `'redis'` and `'vercel-kv'` as built-in providers. References to DynamoDB, Cloudflare KV, D1, and Durable Objects in the table above refer to platform-native storage that you configure outside the SDK (e.g., via AWS SDK, Cloudflare bindings). The SDK does not provide a built-in adapter for these — use them directly in your tools/providers.

## Cross-Cutting Patterns

| Pattern               | Rule                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| Transport selection   | Stateful servers (Node, CLI) can use stdio or SSE; serverless must use Streamable HTTP (stateless)       |
| Storage mapping       | Node: Redis or SQLite; Vercel: Vercel KV; Lambda: DynamoDB; Cloudflare: KV; CLI: SQLite; Browser: memory |
| Environment variables | Never hardcode secrets; use `.env` locally, platform secrets in production                               |
| Build command         | All targets: `frontmcp build --target <target>` produces optimized output                                |
| Entry point           | All targets require `export default` of the `@FrontMcp` class from `main.ts`                             |

## Common Patterns

| Pattern            | Correct                                                 | Incorrect                   | Why                                                                          |
| ------------------ | ------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------- |
| Target selection   | Choose based on infrastructure constraints              | Choose based on familiarity | Each target has different transport, storage, and cold-start characteristics |
| Serverless storage | Use platform-native storage (Vercel KV, DynamoDB)       | Use Redis on serverless     | Platform-native storage avoids VPC/connection overhead on cold starts        |
| Environment config | Platform secrets (Vercel env, AWS SSM)                  | `.env` files in production  | Platform secrets are encrypted, rotatable, and not committed to git          |
| Build verification | Run `frontmcp build --target <target>` before deploying | Deploy source code directly | Build step validates config, bundles dependencies, and optimizes output      |

## Verification Checklist

### Pre-Deployment

- [ ] `frontmcp build --target <target>` completes without errors
- [ ] Environment variables configured for the target platform
- [ ] Storage provider configured and accessible (Redis, KV, DynamoDB, etc.)
- [ ] Transport protocol matches target requirements (stateless for serverless)

### Post-Deployment

- [ ] Health check endpoint responds
- [ ] `tools/list` returns expected tools
- [ ] Tool execution works end-to-end
- [ ] Storage persistence verified (create, read, restart, read again)

## Troubleshooting

| Problem                            | Cause                                        | Solution                                                                        |
| ---------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------- |
| Cold start timeout on serverless   | Bundle too large or heavy initialization     | Lazy-load providers; reduce bundle with tree shaking; increase function timeout |
| Session lost between requests      | Using memory storage on stateless serverless | Switch to platform-native storage (Vercel KV, DynamoDB, etc.)                   |
| CORS errors on browser/web clients | HTTP CORS not configured                     | Add CORS config via `configure-http` skill                                      |
| Build fails with missing module    | Node-only module in browser/edge build       | Use conditional imports or `@frontmcp/utils` cross-platform utilities           |

## Reference

- [Runtime Modes](https://docs.agentfront.dev/frontmcp/deployment/runtime-modes)
- Related skills: `deploy-to-node`, `deploy-to-vercel`, `deploy-to-lambda`, `deploy-to-cloudflare`, `build-for-cli`, `build-for-browser`, `build-for-sdk`, `configure-transport`
