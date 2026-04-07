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

## Stdio Transport

The most common transport. The MCP client spawns your server as a child process and communicates via stdin/stdout JSON-RPC.

**Key points:**

- Pass `--stdio` flag to the binary (detected before CLI framework loads)
- All logs are automatically redirected to stderr and `~/.frontmcp/logs/`
- stdout contains ONLY MCP JSON-RPC protocol messages
- One client per process (no multiplexing)

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

### Node.js bundle

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["/path/to/my-server.bundle.js", "--stdio"]
    }
  }
}
```

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
