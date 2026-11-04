---
name: build-for-cli
description: Build a FrontMCP server as a standalone CLI binary using Node.js SEA or bundled JS
---

# Building a CLI Binary

Build your FrontMCP server as a distributable CLI binary using Node.js Single Executable Applications (SEA) or as a bundled JS file.

## When to Use This Skill

### Must Use

- Distributing your MCP server as a standalone executable that runs without Node.js
- Creating a CLI tool installable via package managers (Homebrew, apt, etc.)
- Producing a self-contained binary for air-gapped or dependency-free deployment

### Recommended

- Shipping an MCP-powered developer tool to end users who may not have Node.js
- Building platform-specific binaries for CI/CD artifact pipelines
- Creating a single-file JS bundle for lightweight Node.js execution

### Skip When

- Deploying to a server environment with Node.js available -- use `--target node`
- Embedding tools in an existing Node.js application -- use `build-for-sdk`
- Targeting browser environments -- use `build-for-browser`

> **Decision:** Choose this skill when your goal is a distributable binary or bundled JS file; use other build targets for server or library deployments.

## Build Commands

### Native Binary (SEA)

```bash
frontmcp build --target cli
```

Produces a Node.js Single Executable Application — a single binary embedding your server code and the Node.js runtime.

### JS Bundle Only

```bash
frontmcp build --target cli --js
```

Produces a bundled JS file without the native binary wrapper. Run with `node dist/server.js`.

### Options

```bash
frontmcp build --target cli -o ./build        # Custom output directory
frontmcp build --target cli -e ./src/main.ts   # Custom entry file
frontmcp build --target cli --js               # JS bundle only (no SEA)
```

### Deployment options (`frontmcp.config`)

```ts
deployments: [
  {
    target: 'cli',
    cli: {
      description: 'Help desk CLI',
      outputDefault: 'text', // or 'json'
      excludeTools: ['internal_sync'], // not exposed as subcommands
      authRequired: true, // adds login / logout / sessions / connect
      oauth: { serverUrl: 'https://auth.example.com', clientId: 'help-desk-cli', defaultScope: 'read' },
    },
  },
],
```

- `excludeTools` leaves those tools out of the generated subcommands.
- `oauth` sets the defaults of `<bin> login` (server URL, client ID, scope,
  callback `portRange`). `login` exists only with `authRequired: true`; the build
  warns when `oauth` is set without it.
- With `authRequired: true`, commands that talk to the server (tools,
  resources, prompts, skills, jobs) refuse to run until the active session has a
  stored credential: they exit 1 with
  `Not logged in. Run "<bin> login" or "<bin> connect --token <token>" first.`
  The stored token is checked like an HTTP `Authorization: Bearer` token, per the
  server's `auth` mode: in process, `connect()` runs it through the same
  `session:verify` flow, and a running daemon receives it as that header. Its
  verified claims are the caller (`this.auth`, and the roles and permissions
  `authorities` rules read through `claimsMapping`), and a token the server rejects
  fails the command (exit 1, `The server's auth did not accept the auth token`).
  The token is verified as one sent to `http://localhost<entryPath>`, so set
  `auth.expectedAudience` (or `FRONTMCP_PUBLIC_URL`) when your IdP puts the
  server's public URL in `aud`. A public server verifies no opaque token, so the
  tools just receive it as `this.context.authInfo.token`. Up to 1.11.0 the token
  only reached `authInfo.token`, and authorization saw an anonymous caller.
- The top-level `build` block applies to the cli bundles too: `build.esbuild` (`external`, `define`, `target`,
  `minify`) and `build.dependencies.nativeAddons` (kept external). A `--target cli` SEA binary is self-contained, so
  `external` doesn't apply to it (see `configure-deployment-targets`, "Build Options").

### The CLI's daemon

`<bin> daemon start` runs the server in the background on
`~/.frontmcp/sockets/<bin>.sock` (`FRONTMCP_HOME` moves `~/.frontmcp`). While it
runs, every command goes to it over the socket instead of starting the server
in its own process, so a plugin's state, such as a loaded Skilled OpenAPI
bundle, stays loaded across commands. The commands send to the server's
`http.entryPath` (`/` by default) and open an MCP session per command, with the
results an in-process command prints. A socket whose daemon does not answer is
reported on stderr (`The daemon at <socket> did not answer (...); running the
command in-process.`), and the command runs in-process. `subscribe` always runs
in-process: the socket cannot push. In production (`NODE_ENV=production`), the
daemon needs `MCP_SESSION_SECRET` like any server. Up to 1.11.0, the commands
posted to `/mcp` without a session, so they never reached the daemon and always
ran in-process.

`<bin> skills read <name>` and `<bin> skills load <ids...>` exit 1 when a skill
is not found, and name it on stderr; `skills load` prints how many of the
requested skills it loaded. Up to 1.11.0 both exited 0.

On a Skilled OpenAPI server, `<bin> run-workflow --script '<AgentScript>'`
exits 1 when the workflow fails (`success: false`), as for any tool that
answers `isError: true`, and `--output json` prints the result with its
`structuredContent` (`success`, `error`, `stats`). The error names a failed
action's status and the API's error body. Up to 1.11.0 a failed workflow
exited 0.

`<bin> execute-action --action-id <actionId> --input '<JSON>'` runs one action
with no script (`--input` can be left out for an action that takes none). It
prints the action's data and exits 0, or exits 1 when the action fails: an
authority denial, a failed input or output check, a timeout, an unknown action,
or an error status, whose text names the API's status and error body. With
`--output json`, a failure's `structuredContent` is `{ ok: false, status,
data?, error? }`, `data` being the API's error body.

## Requirements

- **Node.js 24+** required for the SEA path (`frontmcp build --target cli`). The plain JS bundle path (`--target cli --js`) only requires the Node version your entry file supports.
- The entry file must export or instantiate a `@FrontMcp` decorated class
- SEA binaries are platform-specific (build on macOS for macOS, Linux for Linux)

## CLI Target vs Node Target

| Aspect   | `--target cli`                     | `--target node`                |
| -------- | ---------------------------------- | ------------------------------ |
| Output   | Single binary or JS bundle         | JS files for server deployment |
| Runtime  | Embedded Node.js (SEA) or external | Requires Node.js installed     |
| Use case | Distribution to end users          | Server deployment (Docker, VM) |
| Includes | Bundled dependencies               | External node_modules          |

## Server Configuration for CLI Mode

When building for CLI distribution, configure your server for local/stdin transport:

```typescript
@FrontMcp({
  info: { name: 'my-cli-tool', version: '1.0.0' },
  apps: [MyApp],
  http: { socketPath: '/tmp/my-tool.sock' }, // Unix socket instead of TCP
  sqlite: { path: '~/.my-tool/data.db' }, // Local storage
})
class MyCLIServer {}
```

The generated CLI runs background tasks only on a store its invocations share: the top-level `sqlite` or `redis`, or `tasks.sqlite` / `tasks.redis`. It reads the `tasks` options as the server does: `tasks.store: false` or `tasks.enabled: false` runs no tasks, and `tasks.runner: 'cli'` runs each one in a detached process. Up to 1.10 it ignored every `tasks` option.

It validates the `jobs` options and the top-level `sqlite` as the server does too, so a wrong value stops it at startup with the server's message, such as `jobs.store must be false (runs kept in memory) or an object with redis or sqlite`. `jobs.store: false` keeps job runs in memory beside a top-level `sqlite`. Up to 1.10, a server config given as an object (rather than through `@FrontMcp`, which validates it) could carry a wrong value there: the CLI took an invalid `jobs.store` for unset and kept the runs in the top-level `redis` or `sqlite`, it took an empty `sqlite.path` for the default path, and kept its tasks unencrypted on a missing `sqlite.encryption.secret`.

Every other option the server validates is checked with the server's schema as well, in a config object as in a `@FrontMcp` class: `http`, `transport` (its `persistence`, which the CLI opens for its sessions, and its `eventStore`), `fetch`, `pagination`, `elicitation`, `extApps`, `ui`, `pubsub`, `throttle`, `health`, `metrics` and `authorities`, and `session`, `clients`, `observability`, `registry` and `channels`, which CLI mode leaves off. The CLI runs with each value as given, so the server's defaults for them don't apply in CLI mode. Up to 1.10, a config object's value there reached the CLI unchecked or was dropped, so an invalid `transport.persistence` opened the CLI's session store with it.

The top-level `redis` is read as the server reads it too, in every form (`url`, `host` / `port`, with or without `provider: 'redis'`), so the CLI's tasks go to that Redis, with the URL's password, database and TLS (`rediss://`), and the detached workers of `tasks.runner: 'cli'` find them there. An unusable `redis`, such as a `url` with another scheme, stops it at startup with the server's message. `frontmcp build` reads the server without its stores (`redis`, `pubsub`, `sqlite`, `jobs.store`, `tasks.redis`, `tasks.sqlite`, `transport.persistence`, `transport.eventStore`, `elicitation.redis`, `throttle.storage`, `auth.tokenStorage`, `auth.secureStore`), from a `@FrontMcp` class as from a config object, so a `redis: { url: process.env['REDIS_URL'] }` or an `encryption.secret` from a variable builds without the variable set. The generated CLI validates them when it starts, with the server's schemas: a `@FrontMcp` class's when the decorator reads the class, a config object's in the CLI's own parse. With the variable unset, it stops with the server's message. `transport.eventStore`, `elicitation.redis` and `throttle.storage` are checked although CLI mode never opens them, and `pubsub` although no mode does; `throttle.storage` takes any object in both schemas. Up to 1.10, the CLI's parse of a config object did not check `pubsub`, `transport`, `elicitation` or `throttle`. Up to 1.10, a `@FrontMcp` class validated them when the build loaded the entry, so it needed the variable where it built too. Up to 1.10, a config object's `redis` with a `url` didn't reach the CLI's task store, which kept the tasks in memory or in the Redis of `REDIS_URL` / `REDIS_HOST`.

## Verification

```bash
# Build
frontmcp build --target cli

# Test the binary
./dist/my-server --help

# Or test JS bundle
node dist/my-server.cjs.js
```

## Unix Socket Daemon Mode

Run your MCP server as a local daemon accessible via Unix socket:

```bash
# Start daemon in foreground
frontmcp socket ./src/main.ts -s ~/.frontmcp/sockets/my-app.sock

# Start daemon in background
frontmcp socket ./src/main.ts -b --db ~/.my-tool/data.db

# Default socket path: ~/.frontmcp/sockets/{app-name}.sock
```

The daemon accepts JSON-RPC requests over HTTP via the Unix socket, making it ideal for local MCP clients (Claude Code, IDE extensions) that need persistent tool access without a TCP port.

The socket is the daemon's only boundary, so it is created owner-only (`0600`): only the user running the daemon can connect. `~/.frontmcp/sockets` is created `0700` and `~/.frontmcp` loses group and other write, and startup refuses a socket whose directory, or any directory above it (through symlinks too), another user (other than root) owns or the group or others can write to (unless it has the sticky bit, as `/tmp` does). A start replaces a stale socket a crashed daemon left behind, but refuses a live one (another daemon is answering on it), a regular file, or another user's socket instead of removing it.

## Process Management

Manage long-running MCP server processes with built-in supervisor commands:

```bash
# Start a named server (auto-restarts on crash)
frontmcp start my-server -e ./src/main.ts --max-restarts 5

# Monitor
frontmcp status my-server    # Detailed status for one server
frontmcp status              # Table of all managed servers
frontmcp list                # List all managed processes
frontmcp logs my-server -F   # Tail logs (follow mode)

# Control
frontmcp restart my-server
frontmcp stop my-server      # Graceful shutdown (SIGTERM)
frontmcp stop my-server -f   # Force kill (SIGKILL)
```

## System Service Installation

Install your MCP server as a system service for automatic startup:

```bash
# Install as systemd service (Linux) or launchd service (macOS)
frontmcp service install my-server

# Uninstall service
frontmcp service uninstall my-server
```

## Common Patterns

| Pattern               | Correct                                              | Incorrect                        | Why                                                         |
| --------------------- | ---------------------------------------------------- | -------------------------------- | ----------------------------------------------------------- |
| Node.js version       | Node.js 24+ for SEA builds (not required for `--js`) | Using SEA flow on Node < 24      | SEA support requires Node.js 24+; `--js` bundles do not     |
| Entry file            | Export or instantiate a `@FrontMcp` decorated class  | Export a plain function          | The build expects a FrontMcp entry point                    |
| Transport for CLI     | `socketPath` or stdin/stdout                         | TCP port binding                 | CLI tools run locally; ports may conflict                   |
| Cross-platform binary | Build on each target OS separately                   | Build on macOS and ship to Linux | SEA binaries are platform-specific                          |
| JS-only bundle        | `frontmcp build --target cli --js`                   | `frontmcp build --target node`   | `--target node` assumes server deployment with node_modules |

## Verification Checklist

**Build**

- [ ] `frontmcp build --target cli` completes without errors
- [ ] Output directory contains the expected binary or `.cjs.js` file
- [ ] Output directory contains `frontmcp.manifest.json`, the server manifest every target gets (see `build-manifest`)
- [ ] Binary file size is reasonable (no unexpected bloat)

**Runtime**

- [ ] Binary runs without Node.js installed on a clean machine
- [ ] `--help` flag prints usage information
- [ ] JS bundle runs correctly with `node dist/my-server.cjs.js`

**Distribution**

- [ ] Binary is tested on the target platform (macOS, Linux, Windows)
- [ ] Exit codes are correct (0 for success, non-zero for errors)
- [ ] No hard-coded absolute paths in the bundled output

## Troubleshooting

| Problem                      | Cause                                       | Solution                                                                 |
| ---------------------------- | ------------------------------------------- | ------------------------------------------------------------------------ |
| SEA build fails              | Node.js version below 24                    | Upgrade to Node.js 24+                                                   |
| Binary crashes on startup    | Missing `@FrontMcp` decorated entry         | Ensure entry file exports or instantiates a decorated class              |
| Binary too large             | All dependencies bundled including dev deps | Review dependencies and remove unused packages from bundle               |
| Permission denied on binary  | Missing execute permission                  | Run `chmod +x dist/my-server`                                            |
| Binary fails on different OS | SEA binaries are platform-specific          | Build on the target OS or use CI matrix builds                           |
| `run-workflow` exits 1       | The workflow failed (`success: false`)      | Read `error` (`--output json`); it names the API's status and error body |
| `execute-action` exits 1     | The action failed                           | Read the text, or `structuredContent` (`--output json`): status and body |

## Examples

| Example                                                                 | Level        | Description                                                                                                  |
| ----------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------ |
| [`cli-binary-build`](../examples/build-for-cli/cli-binary-build.md)     | Basic        | Build a FrontMCP server as a standalone binary using Node.js Single Executable Applications (SEA).           |
| [`unix-socket-daemon`](../examples/build-for-cli/unix-socket-daemon.md) | Intermediate | Run a FrontMCP server as a local daemon accessible via Unix socket for IDE extensions and local MCP clients. |

> See all examples in [`examples/build-for-cli/`](../examples/build-for-cli/)

## Reference

- **Docs:** <https://frontmcp.dev/reference/deployment/production-build>
- **Related skills:** `build-for-sdk`, `build-for-browser`, `deploy-to-cloudflare`
