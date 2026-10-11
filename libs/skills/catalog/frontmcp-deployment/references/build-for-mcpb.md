---
name: build-for-mcpb
description: Package a FrontMCP server as a .mcpb archive that Claude Desktop and other MCPB-aware clients install with one click
---

# Building an MCP Bundle (MCPB)

Package your FrontMCP server as a `.mcpb` archive conforming to the
[MCPB v0.3 spec](https://github.com/modelcontextprotocol/mcpb). Consumers
double-click the file — the host client extracts it and runs the server over
stdio. Metadata, tools, prompts, user-configurable inputs, and per-platform
runtime overrides are all declared statically in `manifest.json`.

## When to Use This Skill

### Must Use

- Distributing an MCP server to end users who install via Claude Desktop,
  Cursor, or another MCPB-aware client — no CLI, no `npx`, no registry.
- Attaching a single signed artifact with a stable hash to a GitHub release.
- Exposing install-time configuration (tokens, paths, toggles) through the
  client's native install dialog via `user_config`.

### Recommended

- Shipping optional platform-specific binaries so users without Node installed
  can still run the server.
- Producing reproducible builds — MCPB archives are deterministic by default
  (same inputs → byte-identical output → matching SHA-256).

### Skip When

- You need an interactive CLI with subcommands per tool — use `build-for-cli`.
- You're hosting the server yourself over HTTP — use `deploy-to-node` or a
  serverless target (`deploy-to-vercel`, `deploy-to-lambda`, `deploy-to-cloudflare`).
- You're embedding tools in an existing Node.js application — use `build-for-sdk`.

> **Decision:** Choose `build-for-mcpb` when users install your server through
> an MCPB-aware client; choose `build-for-cli` for terminal-first distribution.

## Build Commands

```bash
# Basic bundle — dist/mcpb/{name}-{version}.mcpb
frontmcp build --target mcpb

# Include a SEA binary for the host platform
frontmcp build --target mcpb --sea

# Merge pre-built cross-platform binaries from CI
frontmcp build --target mcpb --merge-from ./ci-bins

# Skip zipping and inspect the staging directory
frontmcp build --target mcpb --stage-only

# Validate a produced archive
frontmcp mcpb validate dist/mcpb/my-server-1.0.0.mcpb
```

## Requirements

- **Node.js ≥ 22** at build time.
- The entry file must export or instantiate a `@FrontMcp`-decorated class
  (the build-time schema extractor boots it in introspection mode).
- `@frontmcp/sdk` must be installed and reachable at the path used by the
  build (never exclude it from bundling).
- For `--sea` builds, Node.js ≥ 24 is required (FrontMCP targets the current SEA API).
- The SEA binary is self-contained like `server/index.js` (FrontMCP runtime and
  `reflect-metadata` inlined): an SEA binary resolves a bare `require()` against
  Node's built-ins only. Smoke-test it from the extracted archive with
  `FRONTMCP_STDIO=1 ./bin/<platform>/<name>`; `frontmcp mcpb validate` flags a
  binary that still `require()`s a runtime package.

## What the Archive Contains

```text
dist/mcpb/
  my-server-1.0.0.mcpb              # the distributable artifact
  __stage/                          # removed after successful zip
    manifest.json                   # MCPB v0.3 manifest (generated)
    server/
      index.js                      # esbuild single-file CJS bundle
      package.json                  # minimal { type: "commonjs" } marker
      _skills/                      # when capabilities.skills
    bin/                            # when --sea or --merge-from
      darwin/launch                 # picks darwin-arm64 or darwin-x64 by `uname -m`
      darwin-arm64/my-server
      darwin-x64/my-server
      win32-x64/my-server.exe
    icon.png                        # when resolved
    README.md                       # when present in project root
```

## Manifest Sources

| MCPB field                                      | Source (priority order)                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| `name`, `version`                               | frontmcp.config → package.json                                                      |
| `description`                                   | deployment.longDescription first line → package.json.description                    |
| `author`                                        | deployment.author → parsed `package.json.author` string (`"Name <email> (url)"`)    |
| `license`, `homepage`, `repository`, `keywords` | deployment override → package.json fallback                                         |
| `icon`                                          | deployment.icon → package.json.icon → `icon.png` / `assets/icon.png` in cwd         |
| `tools`                                         | Schema extraction (system tools like `execute_job` filtered out)                    |
| `prompts`                                       | Schema extraction; emitted with `prompts_generated: true`                           |
| `user_config`                                   | deployment.userConfig + frontmcp.config `setup.steps` (see below)                   |
| `compatibility.runtimes.node`                   | deployment.compatibility.runtimes.node → frontmcp.config.nodeVersion → `">=22.0.0"` |
| `compatibility.platforms`                       | deployment.compatibility.platforms → `["darwin","linux","win32"]`                   |

## user_config → env

Every `user_config` entry reaches the server as an environment variable: the
manifest's `mcp_config.env` maps `ENV_NAME` to `${user_config.KEY}`, and the
host substitutes the user's answer when it starts the server.

```ts
deployments: [
  {
    target: 'mcpb',
    userConfig: {
      deskApiKey: { type: 'string', title: 'Help desk API key', required: true, sensitive: true },
      exportFolder: { type: 'directory', title: 'Export folder', default: '${HOME}/Documents' },
      region: { type: 'string', title: 'Region', default: 'eu', env: 'HELPDESK_REGION' },
    },
    env: { LOG_FORMAT: 'json' },
  },
],
```

produces

```json
"env": {
  "LOG_FORMAT": "json",
  "DESK_API_KEY": "${user_config.deskApiKey}",
  "EXPORT_FOLDER": "${user_config.exportFolder}",
  "HELPDESK_REGION": "${user_config.region}",
  "FRONTMCP_STDIO": "1"
}
```

| Source                      | `user_config` key                 | Env var                                            |
| --------------------------- | --------------------------------- | -------------------------------------------------- |
| `deployment.userConfig.KEY` | `KEY`                             | `env` on the entry, else `KEY` in UPPER_SNAKE_CASE |
| `setup.steps[]` (top level) | step `id` in camelCase            | step `env`, else the `id` in UPPER_SNAKE_CASE      |
| step + `userConfig.KEY`     | same key (entry overrides fields) | `userConfig.KEY.env`, else the step's env name     |

- UPPER*SNAKE_CASE splits camelCase and replaces other characters with `*`:
`deskApiKey`→`DESK_API_KEY`, `export-folder`→`EXPORT_FOLDER`.
- `env` must be a valid variable name; it is not copied into `user_config`.
- Two entries that map to the same variable fail the build. Give one an explicit `env`.
- The deployment's `env` is merged in first, so a user's answer wins over it.
- `FRONTMCP_STDIO=1` is always set and cannot be overridden: the server speaks
  stdio to the host only with it.
- An optional entry with no `default` that the user leaves blank reaches the
  server as the literal text `${user_config.KEY}` (the reference MCPB host leaves
  unresolved placeholders in place). Give optional entries a `default`, or treat
  that value as unset in your code.

`setup.steps` is a top-level `frontmcp.config` key next to `deployments`; the
same questionnaire drives `frontmcp install` / `frontmcp configure` for the
`node` and `cli` targets.

Type resolution for setup steps:

| FrontMCP schema                                      | MCPB `type`           |
| ---------------------------------------------------- | --------------------- |
| `z.string()`                                         | `string`              |
| `z.number()` / `z.number().int()`                    | `number`              |
| `z.boolean()`                                        | `boolean`             |
| `z.array(z.string())`                                | `string` + `multiple` |
| `deployment.userConfig.X.type: 'directory'` override | `directory`           |
| `deployment.userConfig.X.type: 'file'` override      | `file`                |

Secrets: defaults are stripped when `sensitive: true` so tokens never appear
in the manifest.

Unsupported: `showWhen` / `next` branching — MCPB forms are flat; the
generator logs a warning and renders every step unconditionally.

## Cross-Platform Binaries

Node SEA builds for the host OS/arch only. To ship a `.mcpb` that runs
binary-only on every platform, run the build in a CI matrix and assemble with
`--merge-from`:

```text
ci-bins/
  darwin-arm64/my-server
  darwin-x64/my-server
  linux-arm64/my-server
  linux-x64/my-server
  win32-x64/my-server.exe
```

MCPB hosts look up `platform_overrides` by OS only (`darwin`, `linux`, `win32`),
so the generated keys are OS names. An OS with several architectures (`darwin`,
`linux`) points at `bin/<os>/launch`, a POSIX launcher that runs
`bin/<os>-<arch>/<name>` for the host's `uname -m`; `win32` points straight at
its `x64` binary. An OS gets an override only when every one of its
architectures has a binary. The build skips a partly covered OS and logs the
missing binaries, and its hosts run the Node command and bundled JS. A partial
matrix is still safe. A lone `--sea` build produces a binary for its build
host only, so only a Windows x64 host build supplies an override on its own; a
lone macOS or Linux build supplies none.

## Common Patterns

| Pattern                 | Correct                                    | Incorrect                    | Why                                                             |
| ----------------------- | ------------------------------------------ | ---------------------------- | --------------------------------------------------------------- |
| Entry path              | `${__dirname}/server/index.js`             | Absolute host path           | Host app extracts to a fresh tmp dir each install               |
| User config reference   | `${user_config.apiToken}`                  | `$API_TOKEN`                 | MCPB substitution happens at install time, not shell expansion  |
| Reading a setting       | `process.env.DESK_API_KEY`                 | Reading `manifest.json`      | Each `user_config` entry is passed to the server as an env var  |
| Sensitive defaults      | Omit `default`                             | Emit the real token          | Manifests ship in plaintext; anything in `default` is committed |
| External services       | Declare in `privacy_policies`              | Omit                         | Stores/clients surface these during install review              |
| Multi-platform binaries | CI matrix + `--merge-from`                 | Build on one OS and ship     | SEA binaries are OS/arch-specific                               |
| Prompt `text`           | Leave empty, set `prompts_generated: true` | Try to serialize `execute()` | JS logic doesn't fit MCPB's static `${arguments.KEY}` template  |

## Verification Checklist

**Build**

- [ ] `frontmcp build --target mcpb` exits 0
- [ ] `dist/mcpb/{name}-{version}.mcpb` exists and is a valid ZIP
- [ ] Archive size is reasonable (< 50 MB typical; warn-threshold fires at 50 MB)
- [ ] Two back-to-back builds produce identical SHA-256 (deterministic mode on)

**Manifest**

- [ ] `manifest_version: "0.3"`
- [ ] `server.entry_point` matches the file present in the archive
- [ ] Every `${user_config.KEY}` reference has a matching `user_config[KEY]`
- [ ] No `${…}` substitutions outside the allow-list

**Install**

- [ ] Opening the `.mcpb` in Claude Desktop shows the expected name, description, author, tools
- [ ] `user_config` form renders with correct titles / descriptions / default values
- [ ] Server starts over stdio and answers `initialize` / `tools/list`

## Troubleshooting

| Problem                                                                           | Cause                                                                                 | Solution                                                                                                                             |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `@frontmcp/sdk is required for schema extraction`                                 | SDK missing or externalized from bundle                                               | Ensure `@frontmcp/sdk` is installed                                                                                                  |
| `… requires "@frontmcp/sdk" but the archive has no node_modules`                  | Server entry still `require()`s a runtime package                                     | Rebuild with `frontmcp build --target mcpb` so runtime packages are bundled; `validate` reports archives that are not self-contained |
| `bin/… requires "reflect-metadata", which a single-executable binary cannot load` | SEA binary built with the runtime left external (dies with `No such built-in module`) | Rebuild with `frontmcp build --target mcpb --sea`                                                                                    |
| Archive > 100 MB                                                                  | Large inlined dependencies or SEA binaries                                            | Tune `build.esbuild.external`, or drop `--sea`                                                                                       |
| `includeNodeModules is deprecated and has no effect`                              | `includeNodeModules: true` in the deployment                                          | Remove it: `server/index.js` inlines its runtime packages, so the archive never ships `node_modules`                                 |
| `userConfig "a" and "b" both map to the env var X`                                | Two entries derive the same UPPER_SNAKE_CASE name                                     | Set `env` on one of the entries                                                                                                      |
| Server sees `${user_config.KEY}` as a value                                       | Optional entry with no default left blank by the user                                 | Give the entry a `default`, or treat that value as unset                                                                             |
| `Unknown substitution variable` on validate                                       | Typo in `mcp_config.args` / `env`                                                     | Only `__dirname`, `HOME`, `DESKTOP`, `DOCUMENTS`, `DOWNLOADS`, `pathSeparator`, and declared `user_config` keys are allowed          |
| `entry_point is not present in archive`                                           | Custom `--entry` flag or bundler moved the file                                       | Re-run without the override, or update the config's `entry`                                                                          |
| Two builds produce different SHA-256                                              | `--no-deterministic` set, or inputs embed a changing timestamp                        | Restore deterministic mode; scan your sources for live date/time values                                                              |
| `platform_overrides.{platform}.command` missing binary                            | `--merge-from` folders don't match MCPB platform keys                                 | See the expected layout below                                                                                                        |
| `platform_overrides["darwin-arm64"] is never used`                                | Archive built before 1.9.2 keyed overrides by OS/arch, which hosts never match        | Rebuild; overrides are now keyed by OS                                                                                               |

Expected `--merge-from` layout (platform dirs must match MCPB platform keys):

```text
{dir}/
  darwin-arm64/{name}
  darwin-x64/{name}
  linux-arm64/{name}
  linux-x64/{name}
  win32-x64/{name}.exe
```

## Examples

| Example                                                                | Level | Description                                                                                    |
| ---------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------- |
| [`mcpb-bundle-build`](../examples/build-for-mcpb/mcpb-bundle-build.md) | Basic | Produce a .mcpb archive for Claude Desktop with metadata, tools, and install-time user_config. |

> See all examples in [`examples/build-for-mcpb/`](../examples/build-for-mcpb/)

## Reference

- **MCPB spec:** <https://github.com/modelcontextprotocol/mcpb>
- **Docs:** <https://frontmcp.dev/reference/cli#the-mcpb-target>
- **Related skills:** `build-for-cli`, `build-for-sdk`, `mcp-client-integration`
