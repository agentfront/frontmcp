---
name: frontmcp-config
description: 'Use when you want to configure auth, set up CORS, add rate limiting, throttle requests, manage sessions, choose transport, set HTTP options, add authentication, configure JWT, or set up OAuth. The skill for server CONFIGURATION.'
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

Entry point for configuring FrontMCP servers. This skill helps you find the right configuration skill based on what aspect of your server you need to set up.

## When to Use This Skill

### Must Use

- Setting up a new server and need to understand which configuration options exist
- Deciding between authentication modes, transport protocols, or storage backends
- Planning server configuration across transport, auth, throttling, and storage

### Recommended

- Looking up which skill covers a specific config option (CORS, rate limits, session TTL, etc.)
- Understanding how configuration layers work (server-level vs app-level vs tool-level)
- Reviewing the full configuration surface area before production deployment

### Skip When

- You already know which config area to change (go directly to `configure-transport`, `configure-auth`, etc.)
- You need to build components, not configure the server (see `frontmcp-development`)
- You need to deploy, not configure (see `frontmcp-deployment`)

> **Decision:** Use this skill when you need to figure out WHAT to configure. Use the specific skill when you already know.

## Prerequisites

- A FrontMCP project scaffolded with `frontmcp create` (see `frontmcp-setup`)
- Node.js 24+ and npm/yarn installed

## Steps

1. Identify the configuration area you need using the Scenario Routing Table below
2. Navigate to the specific configuration skill (e.g., `configure-transport`, `configure-auth`) for detailed instructions
3. Apply the configuration in your `@FrontMcp` or `@App` decorator
4. Verify using the Verification Checklist at the end of this skill

## Scenario Routing Table

| Scenario                                                       | Skill                                  | Description                                                      |
| -------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------- |
| Choose between SSE, Streamable HTTP, or stdio                  | `configure-transport`                  | Transport protocol selection with distributed session options    |
| Set up CORS, port, base path, or request limits                | `configure-http`                       | HTTP server options for Streamable HTTP and SSE transports       |
| Add rate limiting, concurrency, or IP filtering                | `configure-throttle`                   | Server-level and per-tool throttle configuration                 |
| Enable tools to ask users for input                            | `configure-elicitation`                | Elicitation schemas, stores, and multi-step flows                |
| Set up authentication (public, transparent, local, remote)     | `configure-auth`                       | OAuth flows, credential vault, multi-app auth                    |
| Configure session storage backends                             | `configure-session`                    | Memory, Redis, Vercel KV, and custom session stores              |
| Add Redis for production storage                               | `setup-redis`                          | Docker Redis, Vercel KV, pub/sub for distributed subscriptions   |
| Add SQLite for local development                               | `setup-sqlite`                         | SQLite with WAL mode, migration helpers                          |
| Understand auth mode details (public/transparent/local/remote) | `configure-auth-modes`                 | Authentication mode details (public, transparent, local, remote) |
| Fine-tune guard configuration for throttling                   | `configure-throttle-guard-config`      | Advanced guard configuration for throttling                      |
| Use transport protocol presets                                 | `configure-transport-protocol-presets` | Transport protocol preset configurations                         |
| Split apps into separate scopes (`splitByApp`)                 | `decorators-guide`                     | Per-app scope and basePath isolation on `@FrontMcp`              |
| Enable widget-to-host communication (ext-apps)                 | `decorators-guide`                     | `extApps` host capabilities, session validation, widget comms    |
| Enable background jobs and workflows                           | `decorators-guide`                     | `jobs: { enabled: true, store? }` on `@FrontMcp`                 |
| Configure pagination for list operations                       | `decorators-guide`                     | `pagination` defaults for `tools/list` endpoint                  |
| Configure npm/ESM package loader for remote apps               | `decorators-guide`                     | `loader` config for `App.esm()` / `App.remote()` resolution      |

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

| Problem                                 | Cause                                            | Solution                                                                                             |
| --------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Server fails to start with config error | Invalid or missing required config field         | Check the error message; FrontMCP validates config at startup and reports the specific invalid field |
| CORS blocked in browser                 | Missing or incorrect CORS origin config          | Add the client's origin to `http.cors.origin`; see `configure-http`                                  |
| Rate limit too aggressive               | Global limit applied to all tools                | Add per-tool overrides for cheap tools with higher limits; see `configure-throttle`                  |
| Sessions lost on serverless             | Using memory session store on stateless platform | Switch to Redis or Vercel KV; see `configure-session`                                                |
| Auth callback fails                     | OAuth redirect URI mismatch                      | Ensure the callback URL in your OAuth provider matches `auth.callbackUrl`; see `configure-auth`      |

## Reference

- [FrontMCP Overview](https://docs.agentfront.dev/frontmcp/fundamentals/overview)
- Related skills: `configure-transport`, `configure-http`, `configure-throttle`, `configure-elicitation`, `configure-auth`, `configure-session`, `setup-redis`, `setup-sqlite`
