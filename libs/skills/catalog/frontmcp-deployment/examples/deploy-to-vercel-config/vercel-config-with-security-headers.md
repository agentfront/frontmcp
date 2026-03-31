---
name: vercel-config-with-security-headers
reference: deploy-to-vercel-config
level: intermediate
description: 'A complete `vercel.json` with per-route security headers for health, MCP, and all other endpoints.'
tags: [deployment, vercel, cache, security, config, headers]
features:
  - 'Per-route header configuration: `/health` and `/mcp` get `Cache-Control: no-store` to prevent caching'
  - 'Global security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`) applied to all routes'
  - 'Setting `framework: null` to tell Vercel this is not a framework project'
---

# vercel.json with Security Headers

A complete `vercel.json` with per-route security headers for health, MCP, and all other endpoints.

## Code

```json
// vercel.json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": null,
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
  "regions": ["iad1"],
  "headers": [
    {
      "source": "/health",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "no-store"
        }
      ]
    },
    {
      "source": "/mcp",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "no-store"
        },
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        }
      ]
    },
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "Referrer-Policy",
          "value": "strict-origin-when-cross-origin"
        }
      ]
    }
  ]
}
```

## What This Demonstrates

- Per-route header configuration: `/health` and `/mcp` get `Cache-Control: no-store` to prevent caching
- Global security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`) applied to all routes
- Setting `framework: null` to tell Vercel this is not a framework project

## Related

- See `deploy-to-vercel-config` for the full reference configuration
- See `deploy-to-vercel` for the complete deployment guide
