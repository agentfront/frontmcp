---
name: vercel-mcp-endpoint-test
reference: deploy-to-vercel
level: advanced
description: 'Verify a Vercel-deployed FrontMCP server by testing health, tool listing, and tool invocation.'
tags: [deployment, json-rpc, vercel, mcp, endpoint]
features:
  - 'Testing the health endpoint and MCP JSON-RPC API of a deployed Vercel function'
  - 'Using preview deployments to validate changes before promoting to production'
  - 'Setting `maxDuration` according to your Vercel plan (Hobby: 10s, Pro: 60s, Enterprise: 900s)'
---

# Testing a Vercel MCP Endpoint

Verify a Vercel-deployed FrontMCP server by testing health, tool listing, and tool invocation.

## Code

```bash
# Health check
curl https://your-project.vercel.app/health
# {"status":"ok"}

# List tools via JSON-RPC
curl -X POST https://your-project.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# Call a tool via JSON-RPC
curl -X POST https://your-project.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"greet","arguments":{"name":"World"}},"id":2}'
```

```bash
# Preview deployment for PR testing
vercel
# Creates a unique preview URL: https://my-project-abc123.vercel.app

# Test the preview before promoting to production
curl https://my-project-abc123.vercel.app/health

# Promote to production
vercel --prod
```

```json
// vercel.json - with maxDuration matching your plan
{
  "rewrites": [{ "source": "/(.*)", "destination": "/api/frontmcp" }],
  "functions": {
    "api/frontmcp.ts": {
      "memory": 1024,
      "maxDuration": 10
    }
  },
  "regions": ["iad1"]
}
```

## What This Demonstrates

- Testing the health endpoint and MCP JSON-RPC API of a deployed Vercel function
- Using preview deployments to validate changes before promoting to production
- Setting `maxDuration` according to your Vercel plan (Hobby: 10s, Pro: 60s, Enterprise: 900s)

## Related

- See `deploy-to-vercel` for the full deployment, KV storage, and cold start optimization guide
