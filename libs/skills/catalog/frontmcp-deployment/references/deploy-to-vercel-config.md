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
