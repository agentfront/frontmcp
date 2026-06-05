---
name: frontmcp-config
description: 'Use when configuring a FrontMCP server through frontmcp.config or the @FrontMcp options. Covers auth modes (public, transparent, local, remote), OAuth plus credential vault and secureStore, CORS, HTTP port / entry-path prefix / unix socket, security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options), rate limiting / throttling / concurrency / timeout / IP filtering (GuardConfig), session storage (Redis, Vercel KV), client transport protocols (SSE, Streamable HTTP, stateless, protocol presets), elicitation, multi-target build config, and skillsConfig (HTTP catalog, caching, audit log, instruction injection). Triggers: configure auth, set up CORS, add rate limiting, throttle requests, manage sessions, choose transport, set HTTP options, configure JWT or OAuth. The skill for server CONFIGURATION.'
when_to_use: |
  Trigger when creating or editing frontmcp.config.ts/js or the @FrontMcp({...})
  options: configuring auth modes, OAuth + credential vault, CORS, HTTP port /
  entry path / unix socket, security headers, rate limiting / throttling /
  GuardConfig, session storage (Redis, Vercel KV), client transport / protocol
  presets, elicitation, multi-target builds, or skillsConfig.
paths: '**/frontmcp.config.*'
tags: [router, config, transport, http, auth, session, redis, sqlite, throttle, guide]
category: config
targets: [all]
bundle: [recommended, full]
priority: 10
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/fundamentals/overview
---

# FrontMCP Configuration Router

Entry point for configuring FrontMCP servers. This skill helps you find the right configuration reference (under `references/`) based on what aspect of your server you need to set up.

## When to Use This Skill

### Must Use

- Setting up a new server and need to understand which configuration options exist
- Deciding between authentication modes, transport protocols, or storage backends
- Planning server configuration across transport, auth, throttling, and storage

### Recommended

- Looking up which reference covers a specific config option (CORS, rate limits, session TTL, etc.)
- Understanding how configuration layers work (server-level vs app-level vs tool-level)
- Reviewing the full configuration surface area before production deployment

### Skip When

- You already know which config area to change (go directly to `configure-transport`, `configure-auth`, etc.)
- You need to build components, not configure the server (see `frontmcp-development`)
- You need to deploy, not configure (see `frontmcp-deployment`)

> **Decision:** Use this skill when you need to figure out WHAT to configure. Open the matching reference under `references/` directly when you already know.

## Prerequisites

- A FrontMCP project scaffolded with `frontmcp create` (see `frontmcp-setup`)
- Node.js 24+ and npm/yarn installed

## Steps

1. Identify the configuration area you need using the Scenario Routing Table below
2. Navigate to the specific configuration reference (e.g., `references/configure-transport.md`, `references/configure-auth.md`) for detailed instructions
3. Apply the configuration in your `@FrontMcp` or `@App` decorator
4. Verify using the Verification Checklist at the end of this skill

## Scenario Routing Table

| Scenario                                                       | Reference                              | Description                                                         |
| -------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------- |
| Choose between SSE, Streamable HTTP, or stdio                  | `configure-transport`                  | Transport protocol selection with distributed session options       |
| Set up CORS, port, base path, or request limits                | `configure-http`                       | HTTP server options for Streamable HTTP and SSE transports          |
| Add rate limiting, concurrency, or IP filtering                | `configure-throttle`                   | Server-level and per-tool throttle configuration                    |
| Enable tools to ask users for input                            | `configure-elicitation`                | Elicitation schemas, stores, and multi-step flows                   |
| Set up authentication (public, transparent, local, remote)     | `configure-auth`                       | OAuth flows, credential vault, multi-app auth                       |
| Configure session storage backends                             | `configure-session`                    | Memory, Redis, Vercel KV, and custom session stores                 |
| Add Redis for production storage                               | `setup-redis`                          | Docker Redis, Vercel KV, pub/sub for distributed subscriptions      |
| Add SQLite for local development                               | `setup-sqlite`                         | SQLite with WAL mode, migration helpers                             |
| Understand auth mode details (public/transparent/local/remote) | `configure-auth-modes`                 | Authentication mode details (public, transparent, local, remote)    |
| Fine-tune guard configuration for throttling                   | `configure-throttle-guard-config`      | Advanced guard configuration for throttling                         |
| Use transport protocol presets                                 | `configure-transport-protocol-presets` | Transport protocol preset configurations                            |
| Configure multi-target deployments and frontmcp.config.ts      | `configure-deployment-targets`         | Typed config with defineConfig(), 9 deployment targets, JSON schema |
| Add CSP, HSTS, X-Frame-Options, and other security headers     | `configure-security-headers`           | CSP directives, report-only mode, HSTS preload, custom headers      |
| Configure skills HTTP, instructions injection, or audit log    | `configure-skills-http`                | Full `skillsConfig` reference: auth, cache, instructions, audit log |
| Split apps into separate scopes (`splitByApp`)                 | `decorators-guide`                     | Per-app scope and basePath isolation on `@FrontMcp`                 |
| Enable widget-to-host communication (ext-apps)                 | `decorators-guide`                     | `extApps` host capabilities, session validation, widget comms       |
| Enable background jobs and workflows                           | `decorators-guide`                     | `jobs: { enabled: true, store? }` on `@FrontMcp`                    |
| Configure pagination for list operations                       | `decorators-guide`                     | `pagination` defaults for `tools/list` endpoint                     |
| Configure npm/ESM package loader for remote apps               | `decorators-guide`                     | `loader` config for `App.esm()` / `App.remote()` resolution         |

## Configuration Layers

FrontMCP configuration cascades through three layers:

```text
Server (@FrontMcp)     ← Global defaults
  └── App (@App)       ← App-level overrides
       └── Tool (@Tool) ← Per-tool overrides
```

| Setting               | Server (`@FrontMcp`)             | App (`@App`)          | Tool (`@Tool`)                              |
| --------------------- | -------------------------------- | --------------------- | ------------------------------------------- |
| Transport             | Yes                              | No                    | No                                          |
| HTTP (CORS, port)     | Yes                              | No                    | No                                          |
| Throttle (rate limit) | Yes (`throttle` global defaults) | No                    | Yes (`rateLimit`, `concurrency`, `timeout`) |
| Auth mode             | Yes                              | Yes (override)        | No                                          |
| Auth providers        | No                               | Yes (`authProviders`) | Yes (`authProviders`)                       |
| Session store         | Yes                              | No                    | No                                          |
| Elicitation           | Yes (enable: `elicitation`)      | No                    | Yes (usage: `this.elicit()`)                |
| ExtApps               | Yes                              | No                    | No                                          |
| Jobs / Workflows      | Yes (`jobs: { enabled }`)        | No                    | No                                          |
| Pagination            | Yes                              | No                    | No                                          |
| SplitByApp            | Yes                              | No                    | No                                          |

## Cross-Cutting Patterns

| Pattern             | Rule                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| Auth + session      | Auth mode determines session requirements: `remote` needs Redis/KV; `public` can use memory       |
| Transport + storage | Stateless transports (serverless) require distributed storage; stateful (Node) can use in-process |
| Throttle scope      | Server-level throttle applies to all tools; per-tool throttle overrides for specific tools        |
| Environment config  | Use environment variables for all secrets (API keys, Redis URLs, OAuth credentials)               |
| Config validation   | FrontMCP validates config at startup; invalid config throws before the server starts              |

## Common Patterns

| Pattern              | Correct                                                                                | Incorrect                                              | Why                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Auth mode for dev    | `auth: { mode: 'public' }` or `auth: { mode: 'transparent', provider: '...' }` locally | `auth: { mode: 'remote', ... }` with real OAuth in dev | Remote auth requires a running OAuth provider; public/transparent are simpler for local dev                     |
| Session store        | Redis for production, memory for development                                           | Memory for production                                  | Memory sessions are lost on restart and don't work across serverless invocations                                |
| Rate limit placement | Server-level for global limits, per-tool for expensive operations                      | Only server-level                                      | Some tools are cheap (list) and some are expensive (generate); per-tool limits prevent abuse of expensive tools |
| CORS config          | Explicit allowed origins in production                                                 | `cors: { origin: '*' }` in production                  | Wildcard CORS allows any origin to call your server                                                             |
| Config secrets       | `process.env.REDIS_URL` via environment variable                                       | Hardcoded `redis://localhost:6379` in source           | Hardcoded secrets leak to git and break in different environments                                               |

## Verification Checklist

### Transport and HTTP

- [ ] Transport protocol configured and server starts without errors
- [ ] CORS allows expected origins (test with browser or curl)
- [ ] Port and base path accessible from client

### Authentication

- [ ] Auth mode set appropriately for the environment (public/transparent for dev, remote for prod)
- [ ] OAuth credentials stored in environment variables, not source code
- [ ] Session store configured with appropriate backend (memory for dev, Redis for prod)

### Throttle and Security

- [ ] Global rate limit configured to prevent abuse
- [ ] Expensive tools have per-tool throttle overrides
- [ ] IP allow/deny lists configured if needed

### Storage

- [ ] Redis or SQLite configured and connectable
- [ ] Storage persists across server restarts (not memory in production)

## Troubleshooting

| Problem                                 | Cause                                            | Solution                                                                                                                          |
| --------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Server fails to start with config error | Invalid or missing required config field         | Check the error message; FrontMCP validates config at startup and reports the specific invalid field                              |
| CORS blocked in browser                 | Missing or incorrect CORS origin config          | Add the client's origin to `http.cors.origin`; see `configure-http`                                                               |
| Rate limit too aggressive               | Global limit applied to all tools                | Add per-tool overrides for cheap tools with higher limits; see `configure-throttle`                                               |
| Sessions lost on serverless             | Using memory session store on stateless platform | Switch to Redis or Vercel KV; see `configure-session`                                                                             |
| Auth callback fails                     | OAuth redirect URI mismatch                      | Ensure the redirect URI registered with your OAuth provider matches the server's `/oauth/callback` endpoint; see `configure-auth` |

## Examples

Each reference has matching examples under [`examples/<reference>/`](./examples/):

### `configure-auth-modes`

| Example                                                                                       | Level        | Description                                                                                 |
| --------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------- |
| [`local-self-signed-tokens`](./examples/configure-auth-modes/local-self-signed-tokens.md)     | Intermediate | Configure a server that signs its own JWT tokens with consent and incremental auth enabled. |
| [`remote-enterprise-oauth`](./examples/configure-auth-modes/remote-enterprise-oauth.md)       | Advanced     | Proxy auth to one mandatory upstream IdP, mint a FrontMCP session, read the upstream token. |
| [`transparent-jwt-validation`](./examples/configure-auth-modes/transparent-jwt-validation.md) | Basic        | Validate externally-issued JWTs without managing token lifecycle on the server.             |

### `configure-auth`

| Example                                                                           | Level        | Description                                                                                                                                                |
| --------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`multi-app-auth`](./examples/configure-auth/multi-app-auth.md)                   | Advanced     | Configure a single FrontMCP server with multiple apps, each using a different auth mode -- public for open endpoints and remote for admin endpoints.       |
| [`public-mode-setup`](./examples/configure-auth/public-mode-setup.md)             | Basic        | Set up a FrontMCP server with public (unauthenticated) access and anonymous scopes.                                                                        |
| [`remote-oauth-with-vault`](./examples/configure-auth/remote-oauth-with-vault.md) | Intermediate | Configure a FrontMCP server with remote OAuth 2.1 authentication and use the credential vault to call downstream APIs on behalf of the authenticated user. |

### `configure-elicitation`

| Example                                                                                              | Level        | Description                                                                         |
| ---------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------- |
| [`basic-confirmation-gate`](./examples/configure-elicitation/basic-confirmation-gate.md)             | Basic        | Request user confirmation before executing a destructive action.                    |
| [`distributed-elicitation-redis`](./examples/configure-elicitation/distributed-elicitation-redis.md) | Intermediate | Configure elicitation with Redis storage for multi-instance production deployments. |

### `configure-http`

| Example                                                                             | Level        | Description                                                                          |
| ----------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------ |
| [`cors-restricted-origins`](./examples/configure-http/cors-restricted-origins.md)   | Basic        | Configure CORS to allow only specific frontend origins with credentials.             |
| [`entry-path-reverse-proxy`](./examples/configure-http/entry-path-reverse-proxy.md) | Intermediate | Mount the MCP server under a URL prefix for reverse proxy or multi-service setups.   |
| [`unix-socket-local`](./examples/configure-http/unix-socket-local.md)               | Intermediate | Bind the server to a unix socket instead of a TCP port for local-only communication. |

### `configure-session`

| Example                                                                              | Level        | Description                                                                      |
| ------------------------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------- |
| [`multi-server-key-prefix`](./examples/configure-session/multi-server-key-prefix.md) | Intermediate | Use unique key prefixes when multiple FrontMCP servers share one Redis instance. |
| [`redis-session-store`](./examples/configure-session/redis-session-store.md)         | Basic        | Configure Redis-backed session storage for production deployments.               |
| [`vercel-kv-session`](./examples/configure-session/vercel-kv-session.md)             | Intermediate | Configure Vercel KV for session storage in serverless Vercel deployments.        |

### `configure-throttle-guard-config`

| Example                                                                                      | Level    | Description                                                              |
| -------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------ |
| [`full-guard-config`](./examples/configure-throttle-guard-config/full-guard-config.md)       | Advanced | Complete GuardConfig using every available field for maximum protection. |
| [`minimal-guard-config`](./examples/configure-throttle-guard-config/minimal-guard-config.md) | Basic    | Enable throttle with just a global rate limit and default timeout.       |

### `configure-throttle`

| Example                                                                                     | Level        | Description                                                                                 |
| ------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------- |
| [`distributed-redis-throttle`](./examples/configure-throttle/distributed-redis-throttle.md) | Advanced     | Configure Redis-backed rate limiting for multi-instance deployments behind a load balancer. |
| [`per-tool-rate-limit`](./examples/configure-throttle/per-tool-rate-limit.md)               | Intermediate | Override server defaults with per-tool rate limits and concurrency caps.                    |
| [`server-level-rate-limit`](./examples/configure-throttle/server-level-rate-limit.md)       | Basic        | Configure global rate limits and IP filtering at the server level.                          |

### `configure-transport-protocol-presets`

| Example                                                                                                   | Level        | Description                                                                   |
| --------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------- |
| [`legacy-preset-nodejs`](./examples/configure-transport-protocol-presets/legacy-preset-nodejs.md)         | Basic        | Use the default legacy preset for maximum compatibility with all MCP clients. |
| [`stateless-api-serverless`](./examples/configure-transport-protocol-presets/stateless-api-serverless.md) | Intermediate | Use the stateless-api preset for Vercel, Lambda, or Cloudflare Workers.       |

### `configure-transport`

| Example                                                                                      | Level        | Description                                                                              |
| -------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------- |
| [`custom-protocol-flags`](./examples/configure-transport/custom-protocol-flags.md)           | Advanced     | Override individual protocol flags instead of using a preset for fine-grained control.   |
| [`distributed-sessions-redis`](./examples/configure-transport/distributed-sessions-redis.md) | Intermediate | Configure transport with Redis persistence for multi-instance load-balanced deployments. |
| [`stateless-serverless`](./examples/configure-transport/stateless-serverless.md)             | Basic        | Configure stateless transport for Vercel, Lambda, or Cloudflare deployments.             |

### `configure-deployment-targets`

| Example                                                                                               | Level        | Description                                                                                                                      |
| ----------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| [`multi-target-with-security`](./examples/configure-deployment-targets/multi-target-with-security.md) | Intermediate | Configure a FrontMCP project with node + distributed targets, CSP headers, and HSTS                                              |
| [`distributed-ha-config`](./examples/configure-deployment-targets/distributed-ha-config.md)           | Advanced     | Configure a distributed deployment target with HA settings for heartbeat, session takeover, and Redis-backed session persistence |
| [`json-schema-ide-support`](./examples/configure-deployment-targets/json-schema-ide-support.md)       | Basic        | Use frontmcp.config.json with JSON Schema for VS Code and WebStorm autocomplete                                                  |

### `configure-security-headers`

| Example                                                                                       | Level        | Description                                                                                                            |
| --------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| [`csp-report-only`](./examples/configure-security-headers/csp-report-only.md)                 | Basic        | Test CSP policies in report-only mode to identify violations before enforcement                                        |
| [`full-production-headers`](./examples/configure-security-headers/full-production-headers.md) | Intermediate | Complete security headers configuration for production with CSP enforcement, HSTS preload, and clickjacking protection |

## Accessing This Skill

Skills are distributed as plain SKILL.md files plus a sibling `references/`
and `examples/` tree, so consumers can pick whichever access mode fits:

| Mode               | How it works                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Filesystem**     | Read `libs/skills/catalog/frontmcp-config/` directly from a clone of the catalog repo, or from a published `@frontmcp/skills` install. SKILL.md is the entry point.                                                                                                                                                                             |
| **`frontmcp` CLI** | `frontmcp skills list`, `frontmcp skills read frontmcp-config`, `frontmcp skills read frontmcp-config:references/<file>.md`, `frontmcp skills install frontmcp-config` — no server required.                                                                                                                                                    |
| **MCP `skill://`** | When a developer mounts this skill into their own FrontMCP server (`@FrontMcp({ skills: [...] })`), the SDK exposes it via SEP-2640 resources: `skill://frontmcp-config/SKILL.md`, `skill://frontmcp-config/references/{file}.md`, etc. The server’s `skill://index.json` returns the SEP-2640 discovery document for everything mounted on it. |

The catalog itself is **not** an MCP server. The `skill://` URIs only resolve
when a server has been configured to host this skill.

## Reference

- [FrontMCP Overview](https://docs.agentfront.dev/frontmcp/fundamentals/overview)
- Related skills: `configure-transport`, `configure-http`, `configure-throttle`, `configure-elicitation`, `configure-auth`, `configure-session`, `setup-redis`, `setup-sqlite`
