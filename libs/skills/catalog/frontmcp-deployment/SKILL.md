---
name: frontmcp-deployment
description: "Domain router for shipping MCP servers \u2014 deploy to Node, Vercel, Lambda, Cloudflare, or build for CLI, browser, and SDK. Use when choosing a deployment target or build format."
tags: [router, deployment, node, vercel, lambda, cloudflare, cli, browser, sdk, guide]
priority: 10
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/deployment/overview
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

| Scenario                                          | Skill                  | Description                                                             |
| ------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------- |
| Long-running server on VPS, Docker, or bare metal | `deploy-to-node`       | Node.js with stdio or HTTP transport, PM2/Docker for process management |
| Serverless with zero config and Vercel KV         | `deploy-to-vercel`     | Vercel Functions with Streamable HTTP, Vercel KV for storage            |
| AWS serverless with API Gateway                   | `deploy-to-lambda`     | Lambda + API Gateway with Streamable HTTP, DynamoDB or ElastiCache      |
| Edge computing with global distribution           | `deploy-to-cloudflare` | Cloudflare Workers with KV or Durable Objects for storage               |
| Standalone executable binary for distribution     | `build-for-cli`        | Single-binary CLI with stdio transport, embedded storage                |
| Run MCP in a web browser                          | `build-for-browser`    | Browser-compatible bundle with in-memory transport                      |
| Embed MCP into an existing Node.js application    | `build-for-sdk`        | Library build for programmatic usage without standalone server          |

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

- [Deployment Overview](https://docs.agentfront.dev/frontmcp/deployment/overview)
- Related skills: `deploy-to-node`, `deploy-to-vercel`, `deploy-to-lambda`, `deploy-to-cloudflare`, `build-for-cli`, `build-for-browser`, `build-for-sdk`, `configure-transport`
