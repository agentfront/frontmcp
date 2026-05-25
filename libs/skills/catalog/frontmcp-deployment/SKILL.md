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

> **Decision:** Use this skill when you need to figure out WHERE to deploy. Open the matching reference under `references/` directly when you already know.

## Prerequisites

- A working FrontMCP server with at least one `@App` and one `@Tool` (see `frontmcp-development`)
- Server configuration completed (see `frontmcp-config`)
- Tests passing locally (see `frontmcp-testing`)

## Steps

1. Review the Scenario Routing Table and Target Comparison below to choose a deployment target
2. Run `frontmcp build --target <target>` to produce the build output
3. Follow the specific deployment reference (e.g., `references/deploy-to-node.md`, `references/deploy-to-vercel.md`) for platform instructions
4. Verify with the Post-Deployment checklist at the end of this skill

## Scenario Routing Table

| Scenario                                          | Reference                          | Description                                                                                                                                      |
| ------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Long-running server on VPS, Docker, or bare metal | `deploy-to-node`                   | Node.js with stdio or HTTP transport, PM2/Docker for process management                                                                          |
| Serverless with zero config and Vercel KV         | `deploy-to-vercel`                 | Vercel Functions with Streamable HTTP, Vercel KV for storage                                                                                     |
| AWS serverless with API Gateway                   | `deploy-to-lambda`                 | Lambda + API Gateway with Streamable HTTP, DynamoDB or ElastiCache                                                                               |
| Edge computing with global distribution           | `deploy-to-cloudflare`             | Cloudflare Workers with KV or Durable Objects for storage                                                                                        |
| Hosted FrontMCP (v1.3 skills-only model)          | `deploy-to-cloudflare-skills-only` | Cloudflare Worker as the MCP control plane; OpenAPI is capability inventory; agent uses 4 meta-tools + AgentScript; hot-reload via GitHub Action |
| Author `frontmcp.deploy.yaml`                     | `deploy-manifest-yaml`             | v1 schema reference: runtime, server, specs, skills, tags, classification, bindings, signing, auth, secrets, environments                        |
| Standalone executable binary for distribution     | `build-for-cli`                    | Single-binary CLI with stdio transport, embedded storage                                                                                         |
| Run MCP in a web browser                          | `build-for-browser`                | Browser-compatible bundle with in-memory transport                                                                                               |
| Embed MCP into an existing Node.js application    | `build-for-sdk`                    | Library build for programmatic usage without standalone server                                                                                   |
| Write a Dockerfile for Node.js deployment         | `deploy-to-node-dockerfile`        | Dockerfile configuration for Node.js deployment                                                                                                  |
| Configure Vercel-specific settings (vercel.json)  | `deploy-to-vercel-config`          | Vercel-specific configuration (vercel.json)                                                                                                      |
| Connect MCP clients (Claude, Cursor, VS Code)     | `mcp-client-integration`           | Configure .mcp.json for stdio, HTTP, or Unix socket transport                                                                                    |

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
| Browser    | In-process direct client    | memory                | None       | Yes      | Client-side AI, demos            |
| SDK        | Programmatic                | Configurable          | None       | Yes      | Embedding in existing apps       |

> **Note on storage:** Only `redis` and `vercel-kv` are SDK-native providers. DynamoDB, Cloudflare KV, D1, and Durable Objects are platform-side — wire them in your tools using the platform SDK / Workers bindings. The Cloudflare build adapter actively rejects `redis: { ... }` and `sqlite: { ... }` configs at build time because Workers has no Node TCP / fs.
>
> **Note on browser:** "In-process direct client" means an in-memory `DirectClient` created via `connect()`/`create()` from `@frontmcp/sdk`. There is no separate "in-memory transport" — the client and server share the same JS heap.

## Cross-Cutting Patterns

| Pattern               | Rule                                                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Transport selection   | Stateful servers (Node, CLI) can use stdio or SSE; serverless must use Streamable HTTP (stateless)                                                                                                                                               |
| Storage mapping       | SDK-native: `redis` (Node, Lambda+ElastiCache, CLI), `vercel-kv` (Vercel, can also work on Cloudflare via Upstash HTTP). Platform-side (you wire it in tools): DynamoDB, Cloudflare KV/D1/DO. Cloudflare build rejects `redis`/`sqlite` configs. |
| Environment variables | Never hardcode secrets; use `.env` locally, platform secrets in production                                                                                                                                                                       |
| Build command         | All targets: `frontmcp build --target <target>` produces optimized output                                                                                                                                                                        |
| Entry point           | All targets require `export default` of the `@FrontMcp` class from `main.ts`                                                                                                                                                                     |

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

## Examples

Each reference has matching examples under [`examples/<reference>/`](./examples/):

### `build-for-browser`

| Example                                                                                              | Level        | Description                                                                                           |
| ---------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| [`browser-build-with-custom-entry`](./examples/build-for-browser/browser-build-with-custom-entry.md) | Intermediate | Build a browser bundle using a dedicated client entry file that avoids Node.js-only imports.          |
| [`browser-crypto-and-storage`](./examples/build-for-browser/browser-crypto-and-storage.md)           | Advanced     | Use `@frontmcp/utils` crypto functions (WebCrypto API) and in-memory storage in browser environments. |
| [`react-provider-setup`](./examples/build-for-browser/react-provider-setup.md)                       | Basic        | Connect a React application to a remote FrontMCP server using `@frontmcp/react`.                      |

### `build-for-cli`

| Example                                                                | Level        | Description                                                                                                  |
| ---------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------ |
| [`cli-binary-build`](./examples/build-for-cli/cli-binary-build.md)     | Basic        | Build a FrontMCP server as a standalone binary using Node.js Single Executable Applications (SEA).           |
| [`unix-socket-daemon`](./examples/build-for-cli/unix-socket-daemon.md) | Intermediate | Run a FrontMCP server as a local daemon accessible via Unix socket for IDE extensions and local MCP clients. |

### `build-for-mcpb`

| Example                                                               | Level | Description                                                                                    |
| --------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------- |
| [`mcpb-bundle-build`](./examples/build-for-mcpb/mcpb-bundle-build.md) | Basic | Produce a .mcpb archive for Claude Desktop with metadata, tools, and install-time user_config. |

### `build-for-sdk`

| Example                                                                        | Level        | Description                                                                                                |
| ------------------------------------------------------------------------------ | ------------ | ---------------------------------------------------------------------------------------------------------- |
| [`connect-openai`](./examples/build-for-sdk/connect-openai.md)                 | Intermediate | Use `connectOpenAI()` to get tools formatted for OpenAI's function-calling API.                            |
| [`create-flat-config`](./examples/build-for-sdk/create-flat-config.md)         | Basic        | Spin up an in-memory FrontMCP server from a flat config object using `create()`.                           |
| [`multi-platform-connect`](./examples/build-for-sdk/multi-platform-connect.md) | Advanced     | Connect the same FrontMCP server to multiple LLM platforms using platform-specific `connect*()` functions. |

### `deploy-to-cloudflare`

| Example                                                                               | Level        | Description                                                                                             |
| ------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| [`basic-worker-deploy`](./examples/deploy-to-cloudflare/basic-worker-deploy.md)       | Basic        | Deploy a FrontMCP server to Cloudflare Workers with a minimal configuration.                            |
| [`worker-custom-domain`](./examples/deploy-to-cloudflare/worker-custom-domain.md)     | Advanced     | Scaffold a FrontMCP project targeting Cloudflare, configure a custom domain, and verify the deployment. |
| [`worker-with-kv-storage`](./examples/deploy-to-cloudflare/worker-with-kv-storage.md) | Intermediate | Deploy a FrontMCP server to Cloudflare Workers with KV namespace for session and state storage.         |

### `deploy-to-lambda`

| Example                                                                               | Level        | Description                                                                                           |
| ------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| [`cdk-deployment`](./examples/deploy-to-lambda/cdk-deployment.md)                     | Advanced     | Deploy a FrontMCP server to AWS Lambda using CDK with provisioned concurrency and secrets management. |
| [`lambda-handler-with-cors`](./examples/deploy-to-lambda/lambda-handler-with-cors.md) | Intermediate | Create a custom Lambda handler with an explicit API Gateway definition for CORS support.              |
| [`sam-template-basic`](./examples/deploy-to-lambda/sam-template-basic.md)             | Basic        | Deploy a FrontMCP server to AWS Lambda with API Gateway using a SAM template.                         |

### `deploy-to-node-dockerfile`

| Example                                                                                              | Level    | Description                                                                                |
| ---------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| [`basic-multistage-dockerfile`](./examples/deploy-to-node-dockerfile/basic-multistage-dockerfile.md) | Basic    | A minimal multi-stage Dockerfile for building and running a FrontMCP server in production. |
| [`secure-nonroot-dockerfile`](./examples/deploy-to-node-dockerfile/secure-nonroot-dockerfile.md)     | Advanced | A production Dockerfile with a non-root user, proper ownership, and security hardening.    |

### `deploy-to-node`

| Example                                                                               | Level        | Description                                                                                               |
| ------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------- |
| [`docker-compose-with-redis`](./examples/deploy-to-node/docker-compose-with-redis.md) | Basic        | Deploy a FrontMCP server with Redis using Docker Compose for production.                                  |
| [`pm2-with-nginx`](./examples/deploy-to-node/pm2-with-nginx.md)                       | Intermediate | Deploy a FrontMCP server on bare metal using PM2 for process management and NGINX for TLS termination.    |
| [`resource-limits`](./examples/deploy-to-node/resource-limits.md)                     | Advanced     | Configure resource limits, health checks, and environment variables for a production FrontMCP deployment. |

### `deploy-to-vercel-config`

| Example                                                                                                            | Level        | Description                                                                                        |
| ------------------------------------------------------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------- |
| [`minimal-vercel-config`](./examples/deploy-to-vercel-config/minimal-vercel-config.md)                             | Basic        | The minimum `vercel.json` needed to deploy a FrontMCP server to Vercel.                            |
| [`vercel-config-with-security-headers`](./examples/deploy-to-vercel-config/vercel-config-with-security-headers.md) | Intermediate | A complete `vercel.json` with per-route security headers for health, MCP, and all other endpoints. |

### `deploy-to-vercel`

| Example                                                                               | Level        | Description                                                                                     |
| ------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| [`vercel-mcp-endpoint-test`](./examples/deploy-to-vercel/vercel-mcp-endpoint-test.md) | Advanced     | Verify a Vercel-deployed FrontMCP server by testing health, tool listing, and tool invocation.  |
| [`vercel-with-kv`](./examples/deploy-to-vercel/vercel-with-kv.md)                     | Basic        | Deploy a FrontMCP server to Vercel serverless functions with Vercel KV for session persistence. |
| [`vercel-with-skills-cache`](./examples/deploy-to-vercel/vercel-with-skills-cache.md) | Intermediate | Deploy a FrontMCP server to Vercel with skills enabled and KV-backed skill caching.             |

### `mcp-client-integration`

| Example                                                                               | Level        | Description                                                                                                  |
| ------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------ |
| [`stdio-npx`](./examples/mcp-client-integration/stdio-npx.md)                         | Basic        | Publish a FrontMCP server to npm and configure MCP clients to use it with npx --stdio.                       |
| [`http-remote`](./examples/mcp-client-integration/http-remote.md)                     | Basic        | Connect an MCP client to a FrontMCP server running as an HTTP server, locally or remotely.                   |
| [`stdio-binary-with-env`](./examples/mcp-client-integration/stdio-binary-with-env.md) | Intermediate | Configure a local FrontMCP CLI binary with environment variables and custom arguments in MCP client configs. |

## Accessing This Skill

Skills are distributed as plain SKILL.md files plus a sibling `references/`
and `examples/` tree, so consumers can pick whichever access mode fits:

| Mode               | How it works                                                                                                                                                                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Filesystem**     | Read `libs/skills/catalog/frontmcp-deployment/` directly from a clone of the catalog repo, or from a published `@frontmcp/skills` install. SKILL.md is the entry point.                                                                                                                                                                                 |
| **`frontmcp` CLI** | `frontmcp skills list`, `frontmcp skills read frontmcp-deployment`, `frontmcp skills read frontmcp-deployment:references/<file>.md`, `frontmcp skills install frontmcp-deployment` — no server required.                                                                                                                                                |
| **MCP `skill://`** | When a developer mounts this skill into their own FrontMCP server (`@FrontMcp({ skills: [...] })`), the SDK exposes it via SEP-2640 resources: `skill://frontmcp-deployment/SKILL.md`, `skill://frontmcp-deployment/references/{file}.md`, etc. The server’s `skill://index.json` returns the SEP-2640 discovery document for everything mounted on it. |

The catalog itself is **not** an MCP server. The `skill://` URIs only resolve
when a server has been configured to host this skill.

## Reference

- [Runtime Modes](https://docs.agentfront.dev/frontmcp/deployment/runtime-modes)
- Related skills: `deploy-to-node`, `deploy-to-vercel`, `deploy-to-lambda`, `deploy-to-cloudflare`, `build-for-cli`, `build-for-browser`, `build-for-sdk`, `configure-transport`
