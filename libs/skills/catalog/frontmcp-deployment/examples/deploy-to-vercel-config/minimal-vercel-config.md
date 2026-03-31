---
name: minimal-vercel-config
reference: deploy-to-vercel-config
level: basic
description: 'The minimum `vercel.json` needed to deploy a FrontMCP server to Vercel.'
tags: [deployment, vercel, serverless, config, minimal]
features:
  - 'The catch-all rewrite (`/(.*) -> /api/frontmcp`) routes all requests to the single FrontMCP handler'
  - 'Setting `buildCommand` and `outputDirectory` so Vercel uses the FrontMCP build pipeline'
  - 'Configuring function memory (512 MB) and max duration (30s) for the serverless function'
---

# Minimal vercel.json Configuration

The minimum `vercel.json` needed to deploy a FrontMCP server to Vercel.

## Code

```json
// vercel.json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "frontmcp build --target vercel",
  "outputDirectory": "dist",
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/api/frontmcp"
    }
  ],
  "functions": {
    "api/frontmcp.js": {
      "memory": 512,
      "maxDuration": 30
    }
  },
  "regions": ["iad1"]
}
```

## What This Demonstrates

- The catch-all rewrite (`/(.*) -> /api/frontmcp`) routes all requests to the single FrontMCP handler
- Setting `buildCommand` and `outputDirectory` so Vercel uses the FrontMCP build pipeline
- Configuring function memory (512 MB) and max duration (30s) for the serverless function

## Related

- See `deploy-to-vercel-config` for the full reference configuration with security headers
