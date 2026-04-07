---
name: http-remote
reference: mcp-client-integration
level: basic
description: Connect an MCP client to a FrontMCP server running as an HTTP server, locally or remotely.
tags: [deployment, http, mcp-client, remote, cloud, production]
features:
  - Connecting to a local FrontMCP dev server on a custom port
  - Connecting to a remote production FrontMCP server with authentication
  - Configuring HTTP transport in Claude Code and Claude Desktop
  - Using a background daemon on a TCP port for persistent local access
---

# Connect to a FrontMCP HTTP Server

Connect an MCP client to a FrontMCP server running as an HTTP server, locally or remotely.

## Code

### Local development

```bash
# Start the server on port 3005
my-server serve -p 3005
```

```json Claude Code (.mcp.json)
{
  "mcpServers": {
    "my-server": {
      "type": "http",
      "url": "http://localhost:3005/mcp"
    }
  }
}
```

### Production (remote server with auth)

```json Claude Code (.mcp.json)
{
  "mcpServers": {
    "my-server": {
      "type": "http",
      "url": "https://my-server.example.com/mcp",
      "headers": {
        "Authorization": "Bearer your-token-here"
      }
    }
  }
}
```

### Background daemon on port

```bash
# Start as a background daemon on port 4000
my-server daemon start -p 4000

# Verify it's running
my-server daemon status
# → Running (PID: 12345, started: 2025-01-01T00:00:00.000Z, port: 4000)

# View logs
my-server daemon logs

# Stop when done
my-server daemon stop
```

```json Claude Code (.mcp.json)
{
  "mcpServers": {
    "my-server": {
      "type": "http",
      "url": "http://localhost:4000/mcp"
    }
  }
}
```

### Serverless (Vercel, AWS Lambda)

```json Claude Code (.mcp.json)
{
  "mcpServers": {
    "my-server": {
      "type": "http",
      "url": "https://my-server.vercel.app/mcp"
    }
  }
}
```

## What This Demonstrates

- Connecting to a local FrontMCP dev server on a custom port
- Connecting to a remote production FrontMCP server with authentication
- Configuring HTTP transport in Claude Code and Claude Desktop
- Using a background daemon on a TCP port for persistent local access

## Related

- See `mcp-client-integration` for the full MCP client configuration reference
- See `deploy-to-node` for production HTTP server deployment
- See `deploy-to-vercel` for serverless deployment
