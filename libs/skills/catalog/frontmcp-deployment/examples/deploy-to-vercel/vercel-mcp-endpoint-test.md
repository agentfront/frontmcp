---
name: vercel-mcp-endpoint-test
reference: deploy-to-vercel
level: advanced
description: Verify a Vercel-deployed FrontMCP server by testing health, tool listing, and tool invocation. The CLI emits the Build Output API v3 structure — there is no `api/frontmcp.ts` to test against; the function lives at `.vercel/output/functions/index.func/handler.cjs` and is routed via `.vercel/output/config.json`.
tags:
  - deployment
  - json-rpc
  - vercel
  - mcp
  - endpoint
features:
  - Testing the health endpoint (`/healthz`) and MCP JSON-RPC API of a deployed Vercel function
  - Using preview deployments to validate changes before promoting to production
  - "Vercel plan limits for `maxDuration` (Hobby: 10s, Pro: 60s, Enterprise: 900s) — configure these in the Vercel dashboard, not via `functions: { 'api/frontmcp.ts': ... }`"
---

# Testing a Vercel MCP Endpoint

Verify a Vercel-deployed FrontMCP server by testing health, tool listing, and tool invocation. The CLI emits the Build Output API v3 structure — there is no `api/frontmcp.ts` to test against; the function lives at `.vercel/output/functions/index.func/handler.cjs` and is routed via `.vercel/output/config.json`.

## Code

```bash
# Health check (FrontMCP serves /healthz by default; /health is a legacy alias)
curl https://your-project.vercel.app/healthz
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
# Build, then preview deployment for PR testing
frontmcp build --target vercel
vercel
# Creates a unique preview URL: https://my-project-abc123.vercel.app

# Test the preview before promoting to production
curl https://my-project-abc123.vercel.app/healthz

# Promote to production
vercel --prod
```

```json
// vercel.json — auto-written by the build adapter; do not add `functions` or
// `rewrites` keyed on `api/frontmcp.ts`/`.js` (no such file exists).
{
  "version": 2,
  "buildCommand": "yarn build",
  "installCommand": "yarn install"
}
```

## What This Demonstrates

- Testing the health endpoint (`/healthz`) and MCP JSON-RPC API of a deployed Vercel function
- Using preview deployments to validate changes before promoting to production
- Vercel plan limits for `maxDuration` (Hobby: 10s, Pro: 60s, Enterprise: 900s) — configure these in the Vercel dashboard, not via `functions: { 'api/frontmcp.ts': ... }`

## Related

- See `deploy-to-vercel` for the full deployment, KV storage, and cold start optimization guide
