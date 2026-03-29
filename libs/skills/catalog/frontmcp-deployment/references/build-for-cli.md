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

## Requirements

- **Node.js 24+** required for SEA support
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

| Pattern               | Correct                                             | Incorrect                        | Why                                                         |
| --------------------- | --------------------------------------------------- | -------------------------------- | ----------------------------------------------------------- |
| Node.js version       | Node.js 24+ for SEA builds                          | Node.js 18 or 20                 | SEA support requires Node.js 24+                            |
| Entry file            | Export or instantiate a `@FrontMcp` decorated class | Export a plain function          | The build expects a FrontMcp entry point                    |
| Transport for CLI     | `socketPath` or stdin/stdout                        | TCP port binding                 | CLI tools run locally; ports may conflict                   |
| Cross-platform binary | Build on each target OS separately                  | Build on macOS and ship to Linux | SEA binaries are platform-specific                          |
| JS-only bundle        | `frontmcp build --target cli --js`                  | `frontmcp build --target node`   | `--target node` assumes server deployment with node_modules |

## Verification Checklist

**Build**

- [ ] `frontmcp build --target cli` completes without errors
- [ ] Output directory contains the expected binary or `.cjs.js` file
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

| Problem                      | Cause                                       | Solution                                                    |
| ---------------------------- | ------------------------------------------- | ----------------------------------------------------------- |
| SEA build fails              | Node.js version below 24                    | Upgrade to Node.js 24+                                      |
| Binary crashes on startup    | Missing `@FrontMcp` decorated entry         | Ensure entry file exports or instantiates a decorated class |
| Binary too large             | All dependencies bundled including dev deps | Review dependencies and remove unused packages from bundle  |
| Permission denied on binary  | Missing execute permission                  | Run `chmod +x dist/my-server`                               |
| Binary fails on different OS | SEA binaries are platform-specific          | Build on the target OS or use CI matrix builds              |

## Reference

- **Docs:** <https://docs.agentfront.dev/frontmcp/deployment/production-build>
- **Related skills:** `build-for-sdk`, `build-for-browser`, `deploy-to-cloudflare`
