---
name: deploy-to-vercel-config
description: Reference vercel.json configuration for deploying a FrontMCP server to Vercel
---

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
"source": "/(.\*)",
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

## Examples

| Example                                                                                                             | Level        | Description                                                                                        |
| ------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------- |
| [`minimal-vercel-config`](../examples/deploy-to-vercel-config/minimal-vercel-config.md)                             | Basic        | The minimum `vercel.json` needed to deploy a FrontMCP server to Vercel.                            |
| [`vercel-config-with-security-headers`](../examples/deploy-to-vercel-config/vercel-config-with-security-headers.md) | Intermediate | A complete `vercel.json` with per-route security headers for health, MCP, and all other endpoints. |

> See all examples in [`examples/deploy-to-vercel-config/`](../examples/deploy-to-vercel-config/)
