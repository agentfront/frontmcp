---
name: vercel-config-with-security-headers
reference: deploy-to-vercel-config
level: intermediate
description: "The Vercel adapter emits a minimal `vercel.json` (version + buildCommand + installCommand). You can layer extra Vercel-supported keys on top after the build — but never add `functions: { 'api/frontmcp.ts': ... }` or `rewrites` to `/api/frontmcp` (the build does not produce an `api/` directory)."
tags:
  - deployment
  - vercel
  - security
  - config
  - headers
features:
  - Adding `regions` to constrain function placement (e.g., `iad1` for US East)
  - 'Per-route `Cache-Control: no-store` on `/healthz` and `/mcp` to prevent caching'
  - 'Global security headers applied to all routes via the catch-all `source: "/(.*)"`'
---

# vercel.json with Regions and Security Headers

The Vercel adapter emits a minimal `vercel.json` (version + buildCommand + installCommand). You can layer extra Vercel-supported keys on top after the build — but never add `functions: { 'api/frontmcp.ts': ... }` or `rewrites` to `/api/frontmcp` (the build does not produce an `api/` directory).

> Note: header configuration is also possible inside your FrontMCP server (works locally and in production). Use `vercel.json` headers when you need them applied at the edge before reaching the function.

## Code

```json
// vercel.json — extends the auto-generated minimum with regions + headers.
// The adapter regenerates buildCommand/installCommand from your lockfile,
// so keep them aligned (or let the build rewrite them).
{
  "version": 2,
  "buildCommand": "yarn build",
  "installCommand": "yarn install",
  "regions": ["iad1"],
  "headers": [
    {
      "source": "/healthz",
      "headers": [{ "key": "Cache-Control", "value": "no-store" }]
    },
    {
      "source": "/mcp",
      "headers": [
        { "key": "Cache-Control", "value": "no-store" },
        { "key": "X-Content-Type-Options", "value": "nosniff" }
      ]
    },
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]
    }
  ]
}
```

## What This Demonstrates

- Adding `regions` to constrain function placement (e.g., `iad1` for US East)
- Per-route `Cache-Control: no-store` on `/healthz` and `/mcp` to prevent caching
- Global security headers applied to all routes via the catch-all `source: "/(.*)"`

## Related

- See `deploy-to-vercel-config` for the full reference and what NOT to do
- See `deploy-to-vercel` for the complete deployment guide
- Security hardening (CSP, HSTS, rate limits) belongs in `frontmcp-production-readiness`
