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

| Field         | Type   | Required | Description                                                                                                                         |
| ------------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | string | Yes      | Server name (kebab-case)                                                                                                            |
| `version`     | string | No       | Server version                                                                                                                      |
| `entry`       | string | No       | Custom entry file path                                                                                                              |
| `deployments` | array  | Yes      | One or more deployment targets                                                                                                      |
| `setup`       | object | No       | `{ steps: [...] }` install-time questionnaire: `frontmcp install` / `configure` for `node` and `cli`, MCPB `user_config` for `mcpb` |
| `build`       | object | No       | Bundler and packaging options for every target that bundles with esbuild (see [Build Options](#build-options-build))                |

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

### How the settings reach the server

`frontmcp build` writes each target's `server` block (and `env`) into the artifact as environment
defaults the server reads at start-up — only where the variable is not already set (an operator's env var
wins), and an explicit `@FrontMcp()` value wins over both:

| Setting                         | Variable                                                        | Applies to                                          |
| ------------------------------- | --------------------------------------------------------------- | --------------------------------------------------- |
| `server.http.port`              | `PORT`                                                          | `node`, `distributed` (serverless: ignored, warns)  |
| `server.http.socketPath`        | `FRONTMCP_DAEMON_SOCKET`                                        | `node`, `distributed`                               |
| `server.http.entryPath`         | `FRONTMCP_HTTP_ENTRY_PATH` (wins over `transport.http.path`)    | every server target                                 |
| `server.http.cors`              | `FRONTMCP_CORS_ORIGINS` (JSON list), `_CREDENTIALS`, `_MAX_AGE` | every server target                                 |
| `server.cookies`                | `FRONTMCP_AFFINITY_COOKIE`, `_DOMAIN`, `_SAMESITE`              | `distributed` (sets the LB affinity cookie)         |
| `server.csp` / `server.headers` | `FRONTMCP_CSP_*`, `FRONTMCP_HSTS`, …                            | every server target                                 |
| `deployments[].env`             | each key as is                                                  | every target except the `browser` / `sdk` libraries |

`node` / `cli` / `mcpb` bundles set them in a preamble when run as the program; `vercel` / `lambda` /
`cloudflare` / `distributed` in the generated setup module. Every artifact also sets
`globalThis.FRONTMCP_BUILD_TARGET` for `availableWhen: { target }` (first one to run wins).
An `mcpb` deployment's `env` is also written into the manifest's `mcp_config.env`, next to one
variable per `userConfig` entry (see `build-for-mcpb`).

### Build Options (`build`)

The top-level `build` block applies to `node`, `cli` and `mcpb` (every target bundled with esbuild):

| Field                       | Effect                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `esbuild.external`          | Packages left out of the bundle and `require()`d at run time                                                  |
| `esbuild.define`            | Identifier replacements, e.g. `{ 'process.env.FLAVOR': '"prod"' }`                                            |
| `esbuild.target`            | esbuild target (default `node22`)                                                                             |
| `esbuild.minify`            | Minify the bundle                                                                                             |
| `dependencies.nativeAddons` | Native addon packages (`.node` binaries): always kept external; the installer and `frontmcp install` add them |
| `dependencies.system`       | System packages the installed app needs (recorded in the build manifest)                                      |
| `storage`, `network`        | Storage type and network defaults recorded in the build manifest                                              |

A self-contained bundle (an SEA binary, or the `mcpb` server) has nothing beside it to load packages from, so
`esbuild.external` does not apply there; `define`, `target` and `minify` do. An `mcpb` archive ships each
`nativeAddons` package with its dependencies in `server/node_modules/` (see `build-for-mcpb`).

### Server HTTP Options

| Field          | Type     | Default | Description                                                                       |
| -------------- | -------- | ------- | --------------------------------------------------------------------------------- |
| `port`         | number   | 3000    | Listen port (node / distributed)                                                  |
| `socketPath`   | string   | ---     | Unix socket (overrides port; node / distributed)                                  |
| `entryPath`    | string   | `/`     | Base path; wins over `transport.http.path` for this deployment                    |
| `cors.origins` | string[] | ---     | CORS allowed origins (`['*']` = any); none = no CORS headers (the server default) |

`bodyLimit` / `urlencodedLimit` are not `frontmcp.config` fields — set them in `@FrontMcp({ http })`.

### Cookie Options (distributed LB affinity cookie)

| Field      | Default           | Description        |
| ---------- | ----------------- | ------------------ |
| `affinity` | `__frontmcp_node` | Cookie name        |
| `domain`   | ---               | `Domain` attribute |
| `sameSite` | `'Strict'`        | `SameSite`         |

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

The build writes these to `FRONTMCP_HA_HEARTBEAT_INTERVAL_MS`, `FRONTMCP_HA_HEARTBEAT_TTL_MS`, `FRONTMCP_HA_TAKEOVER_GRACE_MS` and `FRONTMCP_HA_KEY_PREFIX` in the generated setup file (only where the platform has not set them), which every pod reads at startup.

### Project-Defined CLI Commands (`cli.commands`)

Register project-specific verbs that ship alongside the built-in
`frontmcp` commands. Each verb spawns a runner module (TS or JS) as a
child process — the project's own code never runs in the CLI process.

```typescript
export default defineConfig({
  name: 'my-server',
  deployments: [{ target: 'node' }],
  cli: {
    commands: {
      deploy: {
        entry: './scripts/deploy.ts',
        description: 'Push the current build to staging',
        arguments: [{ name: 'env', required: true }],
        options: [{ flags: '-n, --dry-run' }, { flags: '-c, --concurrency <num>', default: 4 }],
      },
      'db-migrate': { entry: './scripts/migrate.ts' },
    },
  },
});
```

| Field         | Type                       | Description                                         |
| ------------- | -------------------------- | --------------------------------------------------- |
| `entry`       | string                     | Path to runner (TS/JS), relative to project root    |
| `description` | string                     | One-line description (shown in `--help`)            |
| `arguments`   | `ProjectCommandArgument[]` | Positional args (`{ name, required?, variadic? }`)  |
| `options`     | `ProjectCommandOption[]`   | Named options (`{ flags, description?, default? }`) |
| `hidden`      | boolean                    | Hide from `--help` (verb still invokable)           |

Verb names must match `/^[a-zA-Z][a-zA-Z0-9:_-]*$/` and may not collide
with a built-in (`dev`, `build`, `test`, `start`, `skills`, etc.). Use a
namespaced prefix to avoid collisions: `project:init`, `db-migrate`.

Runner selection:

- `.ts` / `.tsx` / `.mts` / `.cts` → `node --import tsx <entry>`
- `.js` / `.mjs` / `.cjs` → `node <entry>`

The runner gets the parsed positionals as argv plus a
`FRONTMCP_PROJECT_COMMAND` env var holding a JSON payload of
`{ verb, positionals, options, cwd }`.

List every registered verb (built-in + project) with:

```bash
frontmcp --list-commands
```

## File Resolution Order

Per-invocation precedence (issue #400):

1. Explicit `--config <path>` flag.
2. `FRONTMCP_CONFIG` env var.
3. Upward walk from `cwd` to the nearest ancestor containing a `frontmcp.config.*` (caps at 10 levels — monorepo nested apps work without `cd <repo-root>`).
4. Fallback: `package.json` (derives name, default node target).

When the upward walk finds the file in a **parent** folder, `frontmcp build` and `frontmcp dev` run from that folder (the project root): `entry`, `deployments[].outDir`, `tsconfig.json`, `package.json` and `.env` resolve there, so building from `src/` writes `dist/` next to the config. Paths passed as flags (`--entry`, `--out-dir`, `--icon`, `--merge-from`, `--log-file`) still resolve from the folder the command ran in. An explicit `--config` / `FRONTMCP_CONFIG` does not change the working folder.

Within a directory:

1. `frontmcp.config.ts`
2. `frontmcp.config.js`
3. `frontmcp.config.json`
4. `frontmcp.config.mjs`
5. `frontmcp.config.cjs`

## Override precedence (issue #400)

For every CLI option that's also expressible in the config:

```
explicit CLI flag  >  frontmcp.config field  >  built-in default
```

There are no per-field `FRONTMCP_<NAME>` environment overrides. The only environment variable the CLI reads for configuration is `FRONTMCP_CONFIG`, which selects the config file (an explicit `--config <path>` flag wins over it).

## Per-command consumption (issue #400)

The config is consumed by every `frontmcp` command, not just `build`:

| Command                           | Config fields consumed                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `build`                           | `name`, `version`, `entry`, `deployments` (incl. `server`, `env`), `build`, `nodeVersion`, `transport.http.path`    |
| `dev`                             | `entry`, `transport.http.port`, `env.shared` ⊕ `env.dev`, first deployment's `server.csp` / `headers` / `http.cors` |
| `test`                            | `test.timeoutMs` / `test.runInBand` / `test.coverage` / `test.testMatch`, `env.shared` ⊕ `env.test`                 |
| `inspector`                       | `transport.default`, `transport.http.port`, `transport.stdio`                                                       |
| `pm start` / `socket` / `service` | `env.shared` ⊕ `env.ship` (config found from the entry's folder upwards; the real env wins)                         |
| `skills install` / `export`       | `skills.provider`, `skills.install` (else `skills.bundle`; `'none'` = nothing), `skills.exportTarget` — flags win   |
| `eject-mcp-config <client>`       | `clients.<client>`, `name`, `transport`, `env.shared` ⊕ `env.ship` (stdio `env`, under the client's own `env`)      |

See `transport`, `env`, `clients`, `test`, `skills` field reference in [`frontmcp.config`](https://frontmcp.dev/reference/server/config-files#frontmcpconfig).

## `transport.http.path` for every build target

`transport.http.path` is the mount path of the MCP endpoint for **every** build target, not only `frontmcp dev`:

| Target                            | How the path reaches the server                                                                                                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node` (and its SEA binary)       | the runner script exports `FRONTMCP_HTTP_ENTRY_PATH`, and the bundle sets the same default itself when run directly (`node dist/node/<name>.bundle.js`, the generated Dockerfile's `CMD`); a real env var wins |
| `vercel`, `lambda`, `distributed` | the generated setup file assigns `process.env.FRONTMCP_HTTP_ENTRY_PATH` before the server loads                                                                                                                |
| `cloudflare`                      | the generated worker setup assigns it the same way                                                                                                                                                             |

A `@FrontMcp({ http: { entryPath } })` value still wins over the config. When the two differ, `frontmcp build` warns.

## `eject-mcp-config` default stdio entry

A `stdio` client with no `command`/`args` gets `npx -y <package.json name> --stdio` (the config's
`name` when there is no `package.json` name): it starts the published package's bin over stdio.
Set `command` and `args` on the client to run something else, e.g. a local build.

## `eject-mcp-config --out` merges

`--out` merges into an existing client config instead of replacing it: the parent folder is created when missing, other top-level keys and other `mcpServers` entries are kept, and only this server's entry is replaced. A file that is not valid JSON (or not a JSON object) is refused and left untouched. `--dry-run` prints the merged result and writes nothing.

## JSON Schema for IDE Support

For JSON configs, add `$schema` for autocomplete and hover docs. The schema ships in the `frontmcp` package and is
published at `https://frontmcp.dev/schemas/frontmcp.config.json`; it is generated from the CLI's own config
validation, so it covers every key the CLI accepts:

```json
{
  "$schema": "./node_modules/frontmcp/frontmcp.schema.json",
  "name": "my-server",
  "deployments": [{ "target": "node" }]
}
```

Use `"$schema": "https://frontmcp.dev/schemas/frontmcp.config.json"` when the project does not install `frontmcp` locally.

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

- [Documentation](https://frontmcp.dev/reference/server/config-files#frontmcpconfig)
- Related skills: `frontmcp-deployment`, `distributed-ha`, `deploy-to-node`, `deploy-to-vercel`
