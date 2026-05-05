---
name: frontmcp-production-readiness
description: 'Pre-production audit and checklist for FrontMCP servers. Use before go-live to verify security hardening, performance checks, observability, monitoring, and health checks. Triggers: production ready, security audit, performance check, production checklist, hardening, go live.'
tags: [production, security, performance, reliability, observability, audit, best-practices]
category: production
targets: [all]
bundle: [recommended, full]
priority: 10
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/deployment/production-build
---

# FrontMCP Production Readiness Audit

Router for production readiness checklists. Start with the common checklist (security, performance, reliability, observability), then follow the target-specific checklist for your deployment environment.

## When to Use This Skill

### Must Use

- Before deploying a FrontMCP server to production for the first time
- After major feature additions or architectural changes
- During security reviews or compliance audits

### Recommended

- As part of PR reviews for infrastructure-touching changes
- Quarterly health checks on production deployments
- When switching deployment targets

### Skip When

- Building a prototype or proof-of-concept
- Running in development/local mode only

> **Decision:** Use this skill when preparing for production. Start with `common-checklist`, then pick your deployment target.

## Prerequisites

- A deployable FrontMCP project (build target chosen, see `frontmcp-deployment`).
- Observability and structured logging available (see `frontmcp-observability`) — production hardening assumes you can see what the server is doing.
- A staging environment matching production target (Node, Vercel, Lambda, Cloudflare, CLI, browser) to validate the checklist before go-live.

## Steps

### Step 1: Detect Deployment Target

Check the project to determine the deployment target:

1. Look at `package.json` scripts for `frontmcp build --target <target>`
2. Check for target-specific files: `ci/Dockerfile` (node), `vercel.json` (vercel), `wrangler.toml` (cloudflare), `ci/template.yaml` (lambda)
3. Check if the build target is `cli` or `browser` in the build config
4. If unclear, ask the user which environment they're deploying to

### Step 2: Run Common Checklist

Always start with the common checklist — it covers security, performance, reliability, and observability that apply to every target.

### Step 3: Run Target-Specific Checklist

After the common checklist, run the checklist for your deployment target.

## Scenario Routing Table

| Scenario                                                 | Reference                                  | Description                                         |
| -------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------- |
| Common security, performance, reliability, observability | `references/common-checklist.md`           | Applies to ALL targets — run this first             |
| Health & readiness endpoints (/healthz, /readyz)         | `references/health-readiness-endpoints.md` | Custom probes, Kubernetes, runtime-aware readiness  |
| Standalone Node.js server with Docker                    | `references/production-node-server.md`     | Docker, health checks, Redis, scaling, CI/CD        |
| Node.js SDK / direct client (npm package)                | `references/production-node-sdk.md`        | create()/connect() API, disposal, npm publishing    |
| Vercel serverless / edge                                 | `references/production-vercel.md`          | Vercel config, edge runtime, cold starts, Vercel KV |
| Cloudflare Workers                                       | `references/production-cloudflare.md`      | Wrangler, Workers runtime, KV, Durable Objects      |
| AWS Lambda                                               | `references/production-lambda.md`          | SAM template, cold starts, DynamoDB, API Gateway    |
| CLI daemon (local MCP server)                            | `references/production-cli-daemon.md`      | Process manager, socket files, service registration |
| CLI binary (one-shot execution)                          | `references/production-cli-binary.md`      | Fast startup, stdio transport, exit codes, npm bin  |
| Browser SDK                                              | `references/production-browser.md`         | Bundle size, browser APIs, CSP, CDN distribution    |

## Quick Reference: Target Detection

| File / Signal Found                                   | Target                                          |
| ----------------------------------------------------- | ----------------------------------------------- |
| `ci/Dockerfile` or `ci/docker-compose.yml`            | Standalone server → `production-node-server.md` |
| `serve: false` or `create()` API usage                | SDK / direct client → `production-node-sdk.md`  |
| `vercel.json`                                         | Vercel → `production-vercel.md`                 |
| `wrangler.toml`                                       | Cloudflare → `production-cloudflare.md`         |
| `ci/template.yaml`                                    | Lambda → `production-lambda.md`                 |
| `frontmcp start` / `socket` / `service install` usage | CLI daemon → `production-cli-daemon.md`         |
| `build --target cli` + `bin` in package.json          | CLI binary → `production-cli-binary.md`         |
| `build --target browser` in scripts                   | Browser → `production-browser.md`               |

## Common Patterns

| Pattern            | Correct                                                   | Incorrect                                         | Why                                                                              |
| ------------------ | --------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------- |
| Checklist order    | Common checklist first, target-specific second            | Skip straight to vendor checklist                 | Common items (auth, rate limits, observability) gate all targets                 |
| Storage            | Redis / Vercel KV in production                           | In-memory session/elicitation stores              | Memory stores reset on every cold start and don't span replicas                  |
| Health checks      | `/healthz` (liveness) + `/readyz` (readiness) endpoints   | Single `/health` endpoint that always returns 200 | Kubernetes/load balancers need separate liveness vs readiness signals            |
| Secret loading     | Read from env vars (`process.env.X`)                      | Hardcode tokens / paste into config               | Hardcoded secrets leak via the build artefact and source control                 |
| Build verification | Run `frontmcp doctor` + smoke test against built artefact | Trust local `dev` mode behaviour                  | Production targets (Vercel, Lambda, Cloudflare, browser) have different runtimes |

## Troubleshooting

| Problem                                       | Cause                                            | Solution                                                                                              |
| --------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Sessions disappear after a deploy             | Memory session store on a stateless platform     | Switch to Redis / Vercel KV; see `setup-redis` and `configure-session`                                |
| Liveness probe passes while requests fail     | `/healthz` doesn't exercise the request path     | Add `/readyz` that checks dependencies (DB, Redis, downstream APIs); see `health-readiness-endpoints` |
| Cold-start latency above SLA                  | Heavy provider construction at request time      | Construct shared clients in module scope or `onInit`; see `production-vercel` / `production-lambda`   |
| Rate-limit exceeded under normal load         | Global throttle too tight, no per-tool overrides | Tune `throttle.requestsPerSecond`; add per-tool overrides; see `configure-throttle`                   |
| `frontmcp doctor` flags missing observability | Observability disabled or not wired              | Set `observability: true` in `@FrontMcp` and configure a sink; see `frontmcp-observability`           |
| Browser build exceeds bundle budget           | Server-only deps imported into the browser entry | Split entries; gate Node-only imports behind `availableWhen.platform`; see `production-browser`       |

## Verification Checklist

After completing both common and target-specific checklists:

1. Run `frontmcp doctor` to check project configuration
2. Run `frontmcp test` to ensure all tests pass
3. Run `frontmcp build` to verify production build succeeds
4. Deploy to staging and run E2E tests against it
5. Review logs for any warnings or errors during startup
6. Update README for the deployment target (see `frontmcp-setup` → `references/readme-guide.md`)

## Examples

Each reference has matching examples under [`examples/<reference>/`](./examples/):

### `common-checklist`

| Example                                                                             | Level        | Description                                                                                                                |
| ----------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| [`caching-and-performance`](./examples/common-checklist/caching-and-performance.md) | Advanced     | Shows how to configure caching with TTL, optimize responses, and manage memory with proper provider lifecycle cleanup.     |
| [`observability-setup`](./examples/common-checklist/observability-setup.md)         | Intermediate | Shows how to configure structured logging, error handling with MCP error codes, and monitoring integration for production. |
| [`security-hardening`](./examples/common-checklist/security-hardening.md)           | Basic        | Shows how to configure authentication, CORS, input validation, and rate limiting for a production FrontMCP server.         |

### `production-browser`

| Example                                                                                 | Level        | Description                                                                                                                                                |
| --------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`browser-bundle-config`](./examples/production-browser/browser-bundle-config.md)       | Basic        | Shows how to configure package.json for browser-compatible SDK distribution with ESM/CJS/UMD entry points, TypeScript declarations, and CDN support.       |
| [`cross-platform-crypto`](./examples/production-browser/cross-platform-crypto.md)       | Intermediate | Shows how to use `@frontmcp/utils` for cross-platform crypto operations that work in both browser and Node.js, and how to avoid Node.js-only APIs.         |
| [`security-and-performance`](./examples/production-browser/security-and-performance.md) | Advanced     | Shows how to ensure no secrets are bundled in browser code, configure CSP headers on the server, optimize bundle size, and avoid blocking the main thread. |

### `production-cli-binary`

| Example                                                                                                | Level        | Description                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [`binary-build-config`](./examples/production-cli-binary/binary-build-config.md)                       | Basic        | Shows how to configure a FrontMCP CLI binary with correct package.json `bin` field, shebang, stdio transport, and npm distribution settings. |
| [`stdio-transport-error-handling`](./examples/production-cli-binary/stdio-transport-error-handling.md) | Intermediate | Shows how to handle stdin/stdout transport correctly, implement proper exit codes, and handle edge cases like EOF and broken pipes.          |

### `production-cli-daemon`

| Example                                                                                      | Level        | Description                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`daemon-socket-config`](./examples/production-cli-daemon/daemon-socket-config.md)           | Basic        | Shows how to configure a FrontMCP server as a long-running local daemon with Unix socket transport, process management, and SQLite storage.                                                   |
| [`graceful-shutdown-cleanup`](./examples/production-cli-daemon/graceful-shutdown-cleanup.md) | Intermediate | Shows how to implement graceful shutdown for a daemon process, including completing in-flight requests, closing database connections, removing the socket file, and cleaning up the PID file. |
| [`security-and-permissions`](./examples/production-cli-daemon/security-and-permissions.md)   | Advanced     | Shows how to secure a local daemon with restrictive socket permissions, XDG-compliant config storage, and file-based secret management.                                                       |

### `production-cloudflare`

| Example                                                                                          | Level        | Description                                                                                                                                               |
| ------------------------------------------------------------------------------------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`durable-objects-state`](./examples/production-cloudflare/durable-objects-state.md)             | Advanced     | Shows how to use Cloudflare Durable Objects for stateful coordination alongside the stateless Workers runtime, with KV for cache and R2 for blob storage. |
| [`workers-runtime-constraints`](./examples/production-cloudflare/workers-runtime-constraints.md) | Intermediate | Shows how to write tools that are compatible with the Cloudflare Workers runtime: no Node.js APIs, no eval, only async I/O, and using Web APIs.           |
| [`wrangler-config`](./examples/production-cloudflare/wrangler-config.md)                         | Basic        | Shows how to configure `wrangler.toml` with correct routes, KV bindings for session storage, and secret management for a FrontMCP Cloudflare Worker.      |

### `production-lambda`

| Example                                                                                      | Level        | Description                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`cold-start-connection-reuse`](./examples/production-lambda/cold-start-connection-reuse.md) | Intermediate | Shows how to minimize Lambda cold starts with lazy initialization, tree-shaking, and the connection reuse pattern for external services.                                                 |
| [`sam-template`](./examples/production-lambda/sam-template.md)                               | Basic        | Shows a complete SAM/CloudFormation template for deploying a FrontMCP server to AWS Lambda with API Gateway routing, DynamoDB for session storage, and proper environment configuration. |
| [`scaling-and-monitoring`](./examples/production-lambda/scaling-and-monitoring.md)           | Advanced     | Shows how to configure concurrency limits, dead letter queues, provisioned concurrency, and CloudWatch alarms for a production Lambda deployment.                                        |

### `production-node-sdk`

| Example                                                                              | Level        | Description                                                                                                                                                                       |
| ------------------------------------------------------------------------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`basic-sdk-lifecycle`](./examples/production-node-sdk/basic-sdk-lifecycle.md)       | Basic        | Shows the complete lifecycle of a FrontMCP SDK package used as an embedded client: initialization, tool invocation, and proper cleanup.                                           |
| [`multi-instance-cleanup`](./examples/production-node-sdk/multi-instance-cleanup.md) | Advanced     | Shows how multiple SDK instances can coexist without conflicts, and how to implement proper cleanup to prevent memory leaks from event listeners, timers, and provider resources. |
| [`package-json-config`](./examples/production-node-sdk/package-json-config.md)       | Intermediate | Shows the correct package.json configuration for publishing a FrontMCP SDK package with CJS + ESM entry points, peer dependencies, and proper file inclusions.                    |

### `production-node-server`

| Example                                                                               | Level        | Description                                                                                                                                         |
| ------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docker-multi-stage`](./examples/production-node-server/docker-multi-stage.md)       | Basic        | Shows a production-ready Dockerfile with multi-stage build, non-root user, and container health check for a FrontMCP Node.js server.                |
| [`graceful-shutdown`](./examples/production-node-server/graceful-shutdown.md)         | Intermediate | Shows how to implement graceful shutdown with SIGTERM handling, in-flight request draining, and health check status transitions.                    |
| [`redis-session-scaling`](./examples/production-node-server/redis-session-scaling.md) | Advanced     | Shows how to configure Redis-backed session storage, connection pooling, and stateless server design for horizontal scaling behind a load balancer. |

### `production-vercel`

| Example                                                                                      | Level        | Description                                                                                                                                           |
| -------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`cold-start-optimization`](./examples/production-vercel/cold-start-optimization.md)         | Intermediate | Shows how to minimize cold start time by lazy-loading dependencies, avoiding heavy initialization at module scope, and caching expensive operations.  |
| [`stateless-serverless-design`](./examples/production-vercel/stateless-serverless-design.md) | Advanced     | Shows a fully stateless server design that works on Vercel edge runtime with no Node.js-only APIs, using `@frontmcp/utils` for cross-platform crypto. |
| [`vercel-edge-config`](./examples/production-vercel/vercel-edge-config.md)                   | Basic        | Shows how to configure a FrontMCP server for Vercel deployment with Vercel KV for session storage and correct route configuration.                    |

### `health-readiness-endpoints`

| Example                                                                             | Level        | Description                                                                                |
| ----------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------ |
| [`basic-health-setup`](./examples/health-readiness-endpoints/basic-health-setup.md) | Basic        | Default health endpoints with Redis session store, showing /healthz and /readyz responses. |
| [`custom-probes`](./examples/health-readiness-endpoints/custom-probes.md)           | Intermediate | Custom database and API probes with Kubernetes deployment configuration.                   |

### `distributed-ha`

| Example                                                                             | Level        | Description                                                                          |
| ----------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------ |
| [`ha-kubernetes-3-replicas`](./examples/distributed-ha/ha-kubernetes-3-replicas.md) | Intermediate | Deploy FrontMCP with 3 replicas, Redis, and automatic session failover on Kubernetes |

## Accessing This Skill

Skills are distributed as plain SKILL.md files plus a sibling `references/`
and `examples/` tree, so consumers can pick whichever access mode fits:

| Mode               | How it works                                                                                                                                                                                                                                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Filesystem**     | Read `libs/skills/catalog/frontmcp-production-readiness/` directly from a clone of the catalog repo, or from a published `@frontmcp/skills` install. SKILL.md is the entry point.                                                                                                                                                                                           |
| **`frontmcp` CLI** | `frontmcp skills list`, `frontmcp skills read frontmcp-production-readiness`, `frontmcp skills read frontmcp-production-readiness:references/<file>.md`, `frontmcp skills install frontmcp-production-readiness` — no server required.                                                                                                                                      |
| **MCP `skill://`** | When a developer mounts this skill into their own FrontMCP server (`@FrontMcp({ skills: [...] })`), the SDK exposes it via SEP-2640 resources: `skill://frontmcp-production-readiness/SKILL.md`, `skill://frontmcp-production-readiness/references/{file}.md`, etc. The server’s `skill://index.json` returns the SEP-2640 discovery document for everything mounted on it. |

The catalog itself is **not** an MCP server. The `skill://` URIs only resolve
when a server has been configured to host this skill.

## Reference

- [Production Build](https://docs.agentfront.dev/frontmcp/deployment/production-build)
- Related skills: `frontmcp-config`, `frontmcp-deployment`, `frontmcp-testing`, `frontmcp-setup`, `frontmcp-observability`
