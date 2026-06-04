---
name: mcp-client-integration
description: Configure MCP clients (Claude Desktop, Claude Code, Cursor, VS Code) to connect to a FrontMCP server via stdio, HTTP, or Unix socket
---

# MCP Client Integration

Configure MCP clients to connect to your FrontMCP server. Covers all transport types (stdio, HTTP, Unix socket) and all major clients (Claude Desktop, Claude Code, Cursor, VS Code).

## When to Use This Skill

### Must Use

- Configuring `.mcp.json`, `claude_desktop_config.json`, or any MCP client config file to point at a FrontMCP server
- Publishing a FrontMCP server to npm for use with `npx` and `--stdio`
- Setting up a local daemon for IDE integration

### Recommended

- Choosing between stdio, HTTP, and Unix socket transport for your deployment scenario
- Passing environment variables or auth tokens to your server from the MCP client config

### Skip When

- Building the server itself (see `frontmcp-development`)
- Configuring server-side transport options (see `frontmcp-config` → `configure-transport`)
- Deploying to cloud platforms (see `deploy-to-vercel`, `deploy-to-lambda`)

> **Decision:** Use this skill when you have a working FrontMCP server and need to connect an MCP client to it.

## Transport Selection

| Scenario                              | Transport   | Server Command                   | Config Key                          |
| ------------------------------------- | ----------- | -------------------------------- | ----------------------------------- |
| npm package for public distribution   | Stdio       | `npx my-server --stdio`          | `command` + `args`                  |
| Local CLI binary for personal use     | Stdio       | `./my-server --stdio`            | `command` + `args`                  |
| Remote/cloud server                   | HTTP        | `my-server serve -p 3000`        | `type: "http"`, `url`               |
| Local persistent daemon (low latency) | Unix Socket | `my-server daemon start`         | `type: "http"`, `url`, `socketPath` |
| Background daemon on specific port    | HTTP        | `my-server daemon start -p 4000` | `type: "http"`, `url`               |
| Vibe coding with AI agent (dev mode)  | HTTP        | `frontmcp dev`                   | `type: "http"`, `url`               |

> **About `daemon` subcommands:** `daemon start | stop | status | logs` are subcommands of the **CLI binary you build with `frontmcp build --target cli`** — the build emits them into your CLI executable. They are NOT subcommands of the global `frontmcp` CLI itself. The framework-level equivalent is `frontmcp socket <entry>` (with `-b` for background, `-s` for socket path). Use whichever matches the binary the user installs.

## Development with AI Coding Agents

When building a FrontMCP server with a coding agent (Claude Code, Cursor, Windsurf), use **HTTP transport with `frontmcp dev`** for live hot reload. The agent edits code, the server auto-restarts, and the MCP client reconnects — no manual restart needed.

### Setup

1. Start the dev server: `npm run dev` (or `frontmcp dev`)
2. Register in `.mcp.json`:
   ```json
   {
     "mcpServers": {
       "my-server": {
         "type": "http",
         "url": "http://localhost:3000/mcp"
       }
     }
   }
   ```
3. Code and iterate — every file save triggers a server reload

### Why HTTP for development (not stdio)

- **Hot reload:** Server restarts on file change (~200ms), client reconnects automatically
- **Multiple clients:** Agent + MCP Inspector + you can all connect simultaneously
- **Debugging:** Logs visible in terminal, Inspector UI available via `npm run inspect`
- **Persistence:** Server stays running across edits, no new process per connection

### `frontmcp dev --stdio` bridge (issue #399)

If the client must speak stdio (MCPB-installed bundles, certain Claude Code configurations) and you still want the dev hot-reload loop, run the first-party watch-aware stdio bridge — replaces the third-party `mcp-remote` recipe:

```bash
frontmcp dev --stdio                  # HTTP loopback under the hood
frontmcp dev --stdio --serve          # stdio-over-pipe (no HTTP listener)
```

Wire the client at the bridge:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "frontmcp", "dev", "--stdio"]
    }
  }
}
```

Bridge guarantees:

- Stdout is 100% JSON-RPC frames; diagnostics go to `./.frontmcp/dev.log` (override with `--log-file`).
- Session id survives reload (pinned via `FRONTMCP_DEV_FORCE_SESSION_ID`).
- Buffered RPCs during reload drain in FIFO once the child reports ready.
- Reload deadline + buffer overflow surface structured errors (`dev_server_unreachable` / `dev_buffer_full` / `dev_reload_deadline` — codes -32099 / -32098 / -32097) so the client spinner clears instead of hanging.

Flags: `--stdio`, `--serve`, `--log-file <path>`, `--buffer-size <n>` (default 8), `--reload-deadline-ms <ms>` (default 30000), `-p <port>` (HTTP-mode loopback, default 3000).

## Stdio Transport

The most common transport. The MCP client spawns your server as a child process and communicates via stdin/stdout JSON-RPC.

**Key points:**

- Pass `--stdio` flag to the binary (detected before CLI framework loads)
- All logs are automatically redirected to stderr and `~/.frontmcp/logs/`
- stdout contains ONLY MCP JSON-RPC protocol messages
- One client per process (no multiplexing)
- **Stdio binds no TCP port** — the HTTP server is disabled, so multiple stdio
  instances of the same server run without an `EADDRINUSE` conflict

### npx (published npm package)

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "my-frontmcp-server", "--stdio"],
      "env": {
        "API_KEY": "sk-xxxxx"
      }
    }
  }
}
```

### Local binary

```json
{
  "mcpServers": {
    "my-server": {
      "command": "/path/to/my-server",
      "args": ["--stdio"]
    }
  }
}
```

### Node.js CLI bundle

Run the **CLI bundle** (`frontmcp build --target cli`) — it parses `--stdio`
itself before any framework initialization:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["/path/to/my-server-cli.bundle.js", "--stdio"]
    }
  }
}
```

### Server runner (`--target node`)

`frontmcp build --target node` emits a runner at `dist/node/<name>`. Pass
`--stdio` to serve over stdin/stdout instead of HTTP — the runner sets
`FRONTMCP_STDIO=1`, so the server connects over stdio and binds no port:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "/path/to/dist/node/my-server",
      "args": ["--stdio"]
    }
  }
}
```

> Do not run the raw `--target node` bundle as `node dist/node/my-server.bundle.js --stdio`
> — that bundle is your `@FrontMcp` server module and starts the HTTP server on
> import. Use the runner above, or set `FRONTMCP_STDIO=1` before the bundle loads.

## HTTP Transport

Connect to a running FrontMCP HTTP server. The server must be started separately.

```json
{
  "mcpServers": {
    "my-server": {
      "type": "http",
      "url": "http://localhost:3005/mcp"
    }
  }
}
```

With authentication:

```json
{
  "mcpServers": {
    "my-server": {
      "type": "http",
      "url": "https://my-server.example.com/mcp",
      "headers": {
        "Authorization": "Bearer token-here"
      }
    }
  }
}
```

## Unix Socket Transport

Connect to a FrontMCP daemon running on a Unix socket. Start the daemon first with `my-server daemon start`.

```json
{
  "mcpServers": {
    "my-server": {
      "type": "http",
      "url": "http://localhost/mcp",
      "socketPath": "/Users/you/.frontmcp/sockets/my-server.sock"
    }
  }
}
```

The `url` hostname is ignored for Unix sockets; only the path (`/mcp`) is used for HTTP routing.

## Publishing to npm

1. Build: `frontmcp build --target cli --js`
2. Set `bin` in `package.json`:
   ```json
   { "bin": { "my-server": "./dist/my-server-cli.bundle.js" } }
   ```
3. Publish: `npm publish`
4. Users configure: `{ "command": "npx", "args": ["-y", "my-server", "--stdio"] }`

## Client Config File Locations

| Client         | File                         | Location                                        |
| -------------- | ---------------------------- | ----------------------------------------------- |
| Claude Code    | `.mcp.json`                  | Project root or `~/.claude/.mcp.json`           |
| Claude Desktop | `claude_desktop_config.json` | `~/Library/Application Support/Claude/` (macOS) |
| Cursor         | `.cursor/mcp.json`           | Project root                                    |
| VS Code        | `.vscode/mcp.json`           | Project root                                    |
| Windsurf       | `mcp_config.json`            | `~/.codeium/windsurf/`                          |

## Claude Code plugin install (issue #411)

For Claude Code specifically, you can ship the whole server — MCP entry +
prompts (as slash commands) + `@Skill`s — as a single Claude Code plugin
folder, registered in one command. This is the recommended path when you
want users to enable/disable the server from `/plugins` rather than
hand-edit `.mcp.json`.

### From a project source (dev tool)

```bash
# At a FrontMCP project root — emits .claude/plugins/<name>/ in cwd
frontmcp plugin install --claude

# Inspect the plan without writing
frontmcp plugin install --claude --dry-run

# Also drop a Codex mcp_servers entry into ~/.codex/config.toml
frontmcp plugin install --claude --codex

# Report install state
frontmcp plugin status --claude

# Remove what install wrote (preserves user-added files)
frontmcp plugin uninstall --claude
```

### From a built bin (end-user)

Every CLI built with `frontmcp build --target cli` inherits the same
behavior under its `install` verb (no new top-level verb):

```bash
my-bin install -p claude              # write .claude/plugins/my-bin/
my-bin install -p claude --scope user # ~/.claude/plugins/my-bin/
my-bin install -p claude -p codex     # both providers in one call
my-bin install --status               # report state per provider
my-bin uninstall -p claude            # remove only managed files
```

### What gets written

```text
.claude/plugins/<bin>/
├── .claude-plugin/plugin.json   # name, version, mcpServers, skills, _meta.frontmcp.managedFiles
├── commands/<prompt>.md         # one per @Prompt the server advertises
└── skills/<name>/SKILL.md       # one per @Skill, with references/examples/scripts/assets subdirs
```

### SKILL.md frontmatter synthesis

Claude Code's filesystem loader discovers skills via the YAML frontmatter at
the top of each `SKILL.md` (`name`, `description`, optional `tags`,
`license`). A `@Skill`-decorated entry typically points
`instructions.file` at a plain markdown body **without** frontmatter, so the
install flow composes the frontmatter from the decorator metadata before
writing the file:

- `name` and `description` come from `@Skill({ name, description })`.
- `tags` and `license` are forwarded when present.
- The instruction file body is copied verbatim AFTER the synthesized
  frontmatter block.
- If the instruction file **already starts with `---`**, the existing
  frontmatter is preserved as-is — the author is treated as authoritative.

Skill names are validated against the same allowlist as plugin names
(`^[a-zA-Z0-9][a-zA-Z0-9._-]*$`) before any filesystem write, so a malicious
`@Skill({ name: '../escape' })` cannot land outside the plugin tree.

### Idempotency

Re-runs are idempotent: any file not listed in `_meta.frontmcp.managedFiles`
(including unknown top-level keys the user added to `plugin.json`, like
`hooks` or extra `mcpServers`) is preserved. Use `--dry-run` to inspect
the planned tree before writing.

## Common Patterns

| Pattern     | Correct                       | Incorrect              | Why                                                 |
| ----------- | ----------------------------- | ---------------------- | --------------------------------------------------- |
| Stdio flag  | `["--stdio"]` as arg          | `"--stdio"` in env var | Flag must be in process argv                        |
| HTTP path   | `url` ends with `/mcp`        | `url` ends with `/`    | FrontMCP serves MCP protocol at `/mcp` by default   |
| Socket URL  | Include `url` field with path | Only `socketPath`      | HTTP routing needs the URL path even for sockets    |
| npx flag    | `"-y"` to auto-confirm        | Omit `-y`              | Without `-y`, npx prompts and blocks the MCP client |
| Env secrets | Use `env` in config           | Hardcode in args       | Env vars are not visible in process listings        |

## Troubleshooting

| Problem                        | Cause                     | Solution                                               |
| ------------------------------ | ------------------------- | ------------------------------------------------------ |
| "Connection failed" with stdio | Server crashes on startup | Check `~/.frontmcp/logs/` for stack traces             |
| Garbled protocol in stdio      | Logs leaking to stdout    | Ensure `--stdio` flag is passed (auto-redirects logs)  |
| `ENOENT` for command           | Binary not found          | Use absolute path or ensure it's in PATH               |
| `ECONNREFUSED` for HTTP        | Server not running        | Start server first: `my-server serve -p PORT`          |
| Socket not found               | Daemon not started        | Run `my-server daemon start`                           |
| npx timeout                    | Package download slow     | Run `npx -y my-server --stdio` manually first to cache |

## Examples

| Example                                                                                | Level        | Description                                                                                                  |
| -------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------ |
| [`stdio-npx`](../examples/mcp-client-integration/stdio-npx.md)                         | Basic        | Publish a FrontMCP server to npm and configure MCP clients to use it with npx --stdio.                       |
| [`http-remote`](../examples/mcp-client-integration/http-remote.md)                     | Basic        | Connect an MCP client to a FrontMCP server running as an HTTP server, locally or remotely.                   |
| [`stdio-binary-with-env`](../examples/mcp-client-integration/stdio-binary-with-env.md) | Intermediate | Configure a local FrontMCP CLI binary with environment variables and custom arguments in MCP client configs. |

> See all examples in [`examples/mcp-client-integration/`](../examples/mcp-client-integration/)

## Reference

- **Docs:** <https://docs.agentfront.dev/frontmcp/deployment/mcp-clients>
- **Related skills:** `build-for-cli`, `deploy-to-node`, `frontmcp-config`
