---
name: configure-deployment-targets
description: Configure multi-target builds with frontmcp.config.ts for node, distributed, vercel, lambda, cloudflare, browser, cli, sdk, and mcpb targets
---

# Configure Deployment Targets

FrontMCP's configuration file defines one or more deployment targets, each with independent server settings, security headers, and HA configuration. Use `defineConfig()` for full TypeScript autocomplete.

## When to Use This Skill

### Must Use

- Deploying to multiple platforms (e.g., node + vercel + distributed) from the same codebase
- Configuring per-target server settings (port, CSP, CORS, HA)
- Setting up security headers for production deployment

### Recommended

- Any project that benefits from typed configuration with IDE autocomplete
- Multi-environment setups (dev vs staging vs production targets)

### Skip When

- Single-target projects using CLI flags only (`frontmcp build --target node`)
- You only need to configure auth modes or sessions (see `configure-auth-modes`, `configure-session`)

> **Decision:** Use this skill when you need a configuration file with multi-target or per-target server settings. Skip for simple single-target CLI builds.

## Prerequisites

- `frontmcp` installed
- A working FrontMCP server (see `frontmcp-development`)

## Step 1: Create Configuration File

```typescript
// frontmcp.config.ts
import { defineConfig } from 'frontmcp';

export default defineConfig({
  name: 'my-server',
  version: '1.0.0',
  deployments: [{ target: 'node' }],
});
```

## Step 2: Add Deployment Targets

```typescript
export default defineConfig({
  name: 'my-server',
  deployments: [
    { target: 'node', server: { http: { port: 3000 } } },
    {
      target: 'distributed',
      ha: { heartbeatIntervalMs: 5000, heartbeatTtlMs: 15000 },
    },
    { target: 'vercel' },
  ],
});
```

## Step 3: Configure Server Settings

```typescript
export default defineConfig({
  name: 'my-server',
  deployments: [
    {
      target: 'node',
      server: {
        http: { port: 3000, cors: { origins: ['https://app.example.com'] } },
        csp: {
          enabled: true,
          directives: {
            'default-src': "'self'",
            'upgrade-insecure-requests': '',
          },
        },
        headers: {
          hsts: 'max-age=31536000; includeSubDomains',
          contentTypeOptions: 'nosniff',
          frameOptions: 'DENY',
        },
      },
    },
  ],
});
```

## Step 4: Build for Each Target

```bash
frontmcp build --target node
frontmcp build --target distributed
frontmcp build --target vercel
```

## Configuration Reference

### Top-Level Fields

| Field         | Type   | Required | Description                    |
| ------------- | ------ | -------- | ------------------------------ |
| `name`        | string | Yes      | Server name (kebab-case)       |
| `version`     | string | No       | Server version                 |
| `entry`       | string | No       | Custom entry file path         |
| `deployments` | array  | Yes      | One or more deployment targets |

### Available Targets

| Target        | Transport        | Storage               | Use Case                |
| ------------- | ---------------- | --------------------- | ----------------------- |
| `node`        | HTTP, SSE, stdio | Redis, SQLite, memory | VPS, Docker, bare metal |
| `distributed` | HTTP             | Redis (required)      | Multi-pod with HA       |
| `vercel`      | HTTP             | Vercel KV             | Serverless with Vercel  |
| `lambda`      | HTTP             | DynamoDB, ElastiCache | AWS serverless          |
| `cloudflare`  | HTTP             | KV, Durable Objects   | Edge computing          |
| `browser`     | In-memory        | Memory                | Web browser             |
| `cli`         | stdio            | SQLite, memory        | Standalone binary       |
| `sdk`         | Direct           | Configurable          | Library embedding       |
| `mcpb`        | stdio            | SQLite, memory        | `.mcpb` MCP bundles     |

### Server HTTP Options

| Field          | Type     | Default | Description                  |
| -------------- | -------- | ------- | ---------------------------- |
| `port`         | number   | 3000    | Listen port                  |
| `socketPath`   | string   | ---     | Unix socket (overrides port) |
| `entryPath`    | string   | `/`     | Base path                    |
| `cors.origins` | string[] | ---     | CORS allowed origins         |

### CSP Options

| Field        | Type                                 | Default | Description            |
| ------------ | ------------------------------------ | ------- | ---------------------- |
| `enabled`    | boolean                              | false   | Enable CSP headers     |
| `directives` | `Record<string, string \| string[]>` | ---     | Directive-to-value map |
| `reportUri`  | string                               | ---     | Violation report URI   |
| `reportOnly` | boolean                              | false   | Report-only mode       |

### Security Headers

| Field                | Default   | Header                      |
| -------------------- | --------- | --------------------------- |
| `hsts`               | ---       | `Strict-Transport-Security` |
| `contentTypeOptions` | `nosniff` | `X-Content-Type-Options`    |
| `frameOptions`       | `DENY`    | `X-Frame-Options`           |

### HA Configuration (distributed target only)

| Field                   | Type   | Default   | Description                  |
| ----------------------- | ------ | --------- | ---------------------------- |
| `heartbeatIntervalMs`   | number | 10000     | Heartbeat write interval     |
| `heartbeatTtlMs`        | number | 30000     | Heartbeat TTL                |
| `takeoverGracePeriodMs` | number | 5000      | Grace period before takeover |
| `redisKeyPrefix`        | string | `mcp:ha:` | Redis key prefix             |

## File Resolution Order

Per-invocation precedence (issue #400):

1. Explicit `--config <path>` flag.
2. `FRONTMCP_CONFIG` env var.
3. Upward walk from `cwd` to the nearest ancestor containing a `frontmcp.config.*` (caps at 10 levels — monorepo nested apps work without `cd <repo-root>`).
4. Fallback: `package.json` (derives name, default node target).

Within a directory:

1. `frontmcp.config.ts`
2. `frontmcp.config.js`
3. `frontmcp.config.json`
4. `frontmcp.config.mjs`
5. `frontmcp.config.cjs`

## Override precedence (issue #400)

For every CLI option that's also expressible in the config:

```
explicit CLI flag  >  FRONTMCP_<NAME> env var  >  frontmcp.config field  >  built-in default
```

## Per-command consumption (issue #400)

The config is consumed by every `frontmcp` command, not just `build`:

| Command                           | Config fields consumed                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| `build`                           | `name`, `version`, `entry`, `deployments`, `build`, `nodeVersion`                                   |
| `dev`                             | `entry`, `transport.http.port`, `env.shared` ⊕ `env.dev`                                            |
| `test`                            | `test.timeoutMs` / `test.runInBand` / `test.coverage` / `test.testMatch`, `env.shared` ⊕ `env.test` |
| `inspector`                       | `transport.default`, `transport.http.port`, `transport.stdio`                                       |
| `pm start` / `socket` / `service` | `name`, `entry`, `transport.http.port`, `transport.http.socketPath`, `env.shared` ⊕ `env.ship`      |
| `skills install` / `export`       | `skills.provider`, `skills.bundle`, `skills.install`, `skills.exportTarget`                         |
| `eject-mcp-config <client>`       | `clients.<client>`, `name`, `transport`, `env.ship`                                                 |

See `transport`, `env`, `clients`, `test`, `skills` field reference in [docs/frontmcp/deployment/frontmcp-config](https://docs.agentfront.dev/frontmcp/deployment/frontmcp-config).

## JSON Schema for IDE Support

For JSON configs, add `$schema` for autocomplete:

```json
{
  "$schema": "./node_modules/frontmcp/frontmcp.schema.json",
  "name": "my-server",
  "deployments": [{ "target": "node" }]
}
```

## Common Patterns

| Pattern        | Correct                                                | Incorrect                           | Why                                                          |
| -------------- | ------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------ |
| Config helper  | `defineConfig({...})`                                  | Plain object export                 | Loses IDE autocomplete                                       |
| HA config      | Only on `distributed` target                           | On `node` or `vercel` target        | HA requires Redis + multi-pod                                |
| CSP directives | `{ 'default-src': "'self'" }` (record of name → value) | A single semicolon-separated string | Schema is `Record<string, string \| string[]>`, not a string |

## Verification Checklist

### Configuration

- [ ] `frontmcp.config.ts` exists in project root
- [ ] `name` is kebab-case with no spaces
- [ ] At least one deployment target defined
- [ ] HA config only on `distributed` target

### Runtime

- [ ] `frontmcp build --target <target>` succeeds for each target
- [ ] Security headers visible in response (`curl -I http://localhost:3000/healthz`)
- [ ] CSP header present when `csp.enabled: true`

## Examples

| Example                                                                                                | Level        | Description                                                                                                                      |
| ------------------------------------------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| [`multi-target-with-security`](../examples/configure-deployment-targets/multi-target-with-security.md) | Intermediate | Configure a FrontMCP project with node + distributed targets, CSP headers, and HSTS                                              |
| [`distributed-ha-config`](../examples/configure-deployment-targets/distributed-ha-config.md)           | Advanced     | Configure a distributed deployment target with HA settings for heartbeat, session takeover, and Redis-backed session persistence |
| [`json-schema-ide-support`](../examples/configure-deployment-targets/json-schema-ide-support.md)       | Basic        | Use frontmcp.config.json with JSON Schema for VS Code and WebStorm autocomplete                                                  |

> See all examples in [`examples/configure-deployment-targets/`](../examples/configure-deployment-targets/)

## Reference

- [Documentation](https://docs.agentfront.dev/frontmcp/deployment/frontmcp-config)
- Related skills: `frontmcp-deployment`, `distributed-ha`, `deploy-to-node`, `deploy-to-vercel`
