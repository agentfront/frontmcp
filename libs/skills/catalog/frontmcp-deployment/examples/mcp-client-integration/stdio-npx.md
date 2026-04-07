---
name: stdio-npx
reference: mcp-client-integration
level: basic
description: Publish a FrontMCP server to npm and configure MCP clients to use it with npx --stdio.
tags: [deployment, stdio, npx, npm, mcp-client, claude-code, claude-desktop]
features:
  - Building a FrontMCP server as a distributable CLI bundle
  - Configuring package.json bin field for npx execution
  - Setting up Claude Code, Claude Desktop, and Cursor to use the server via stdio
  - Passing environment variables from MCP client config to the server
---

# Publish and Use via npx --stdio

Publish a FrontMCP server to npm and configure MCP clients to use it with npx --stdio.

## Code

### 1. Build the CLI bundle

```bash
frontmcp build --target cli --js
```

### 2. Configure package.json

```json
{
  "name": "my-weather-mcp",
  "version": "1.0.0",
  "description": "Weather data MCP server",
  "bin": {
    "my-weather-mcp": "./dist/my-weather-mcp-cli.bundle.js"
  },
  "files": ["dist/"],
  "dependencies": {
    "@frontmcp/sdk": "^1.0.0"
  }
}
```

### 3. Publish to npm

```bash
npm publish
```

### 4. Configure MCP clients

```json Claude Code (.mcp.json)
{
  "mcpServers": {
    "weather": {
      "command": "npx",
      "args": ["-y", "my-weather-mcp", "--stdio"],
      "env": {
        "WEATHER_API_KEY": "your-api-key"
      }
    }
  }
}
```

```json Claude Desktop (claude_desktop_config.json)
{
  "mcpServers": {
    "weather": {
      "command": "npx",
      "args": ["-y", "my-weather-mcp", "--stdio"],
      "env": {
        "WEATHER_API_KEY": "your-api-key"
      }
    }
  }
}
```

## What This Demonstrates

- Building a FrontMCP server as a distributable CLI bundle
- Configuring package.json bin field for npx execution
- Setting up Claude Code, Claude Desktop, and Cursor to use the server via stdio
- Passing environment variables from MCP client config to the server

## Related

- See `mcp-client-integration` for the full MCP client configuration reference
- See `build-for-cli` for CLI build options and SEA binary creation
