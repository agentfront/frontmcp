---
name: stdio-binary-with-env
reference: mcp-client-integration
level: intermediate
description: Configure a local FrontMCP CLI binary with environment variables and custom arguments in MCP client configs.
tags: [deployment, stdio, cli, binary, env, mcp-client, configuration]
features:
  - Pointing MCP clients at a locally installed FrontMCP binary
  - Passing database URLs, API keys, and feature flags via environment variables
  - Using absolute paths for reliable binary resolution
  - Configuring different environments (dev, staging) via env vars
---

# Local Binary with Environment Variables

Configure a local FrontMCP CLI binary with environment variables and custom arguments in MCP client configs.

## Code

### Install and build the binary

```bash
# Build the CLI binary
frontmcp build --target cli

# Install it (creates symlink in ~/.local/bin/)
my-server install
```

### Development configuration

```json Claude Code (.mcp.json)
{
  "mcpServers": {
    "my-server-dev": {
      "command": "/Users/you/.local/bin/my-server",
      "args": ["--stdio"],
      "env": {
        "DATABASE_URL": "postgresql://localhost:5432/mydb_dev",
        "REDIS_URL": "redis://localhost:6379",
        "API_KEY": "sk-dev-xxxxx",
        "LOG_LEVEL": "debug",
        "NODE_ENV": "development"
      }
    }
  }
}
```

### Staging configuration

```json Claude Code (.mcp.json)
{
  "mcpServers": {
    "my-server-staging": {
      "command": "/Users/you/.local/bin/my-server",
      "args": ["--stdio"],
      "env": {
        "DATABASE_URL": "postgresql://staging-db.example.com:5432/mydb",
        "REDIS_URL": "redis://staging-redis.example.com:6379",
        "API_KEY": "sk-staging-xxxxx",
        "LOG_LEVEL": "warn",
        "NODE_ENV": "staging"
      }
    }
  }
}
```

### Multiple servers in one config

```json Claude Code (.mcp.json)
{
  "mcpServers": {
    "backend-tools": {
      "command": "/Users/you/.local/bin/backend-server",
      "args": ["--stdio"],
      "env": {
        "DATABASE_URL": "postgresql://localhost:5432/backend"
      }
    },
    "docs-tools": {
      "command": "npx",
      "args": ["-y", "docs-mcp-server", "--stdio"],
      "env": {
        "DOCS_PATH": "/Users/you/docs"
      }
    },
    "analytics": {
      "type": "http",
      "url": "https://analytics.example.com/mcp"
    }
  }
}
```

## What This Demonstrates

- Pointing MCP clients at a locally installed FrontMCP binary
- Passing database URLs, API keys, and feature flags via environment variables
- Using absolute paths for reliable binary resolution
- Configuring different environments (dev, staging) via env vars

## Related

- See `mcp-client-integration` for the full MCP client configuration reference
- See `build-for-cli` for CLI build and installation options
