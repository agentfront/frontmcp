---
name: production-vercel
description: Checklist for deploying FrontMCP to Vercel serverless or edge functions with Vercel KV
---

# Production Readiness: Vercel / Edge

Target-specific checklist for deploying FrontMCP to Vercel serverless or edge functions.

> Run the `common-checklist` first, then use this checklist for Vercel-specific items.

## Vercel Configuration

- [ ] `vercel.json` is configured with correct function routes
- [ ] `frontmcp build --target vercel` produces the correct output
- [ ] Environment variables are set in Vercel dashboard (not `.env`)
- [ ] `VERCEL_URL` or custom domain is configured for CORS origins

## Edge Runtime

- [ ] No Node.js-only APIs used (no `fs`, `child_process`, `net`)
- [ ] No `node:crypto` direct imports — use `@frontmcp/utils` (cross-platform)
- [ ] No large npm packages that exceed edge bundle size limits
- [ ] Streaming responses work correctly on the edge runtime

## Session & Storage

- [ ] Session storage uses Vercel KV (not in-memory or Redis)
- [ ] Cache uses Vercel KV or edge-compatible store
- [ ] No file system access (serverless is ephemeral)
- [ ] SQLite is NOT used (not available on serverless)

## Cold Starts

- [ ] Server startup time is minimal (< 1s target for cold starts)
- [ ] Lazy-load expensive dependencies
- [ ] No heavy initialization in module scope
- [ ] OpenAPI spec is cached (not fetched on every invocation)

## Scaling

- [ ] Stateless design (no in-memory state between invocations)
- [ ] Connection pooling accounts for serverless concurrency
- [ ] Function timeout is set appropriately in vercel.json
- [ ] Memory allocation matches workload

## CI/CD

- [ ] `vercel.json` routes are correct
- [ ] Environment variables are set in Vercel project settings
- [ ] Preview deployments test the full MCP flow
- [ ] Production deployment uses `npx vercel --prod`

## Examples

| Example                                                                                       | Level        | Description                                                                                                                                           |
| --------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`cold-start-optimization`](../examples/production-vercel/cold-start-optimization.md)         | Intermediate | Shows how to minimize cold start time by lazy-loading dependencies, avoiding heavy initialization at module scope, and caching expensive operations.  |
| [`stateless-serverless-design`](../examples/production-vercel/stateless-serverless-design.md) | Advanced     | Shows a fully stateless server design that works on Vercel edge runtime with no Node.js-only APIs, using `@frontmcp/utils` for cross-platform crypto. |
| [`vercel-edge-config`](../examples/production-vercel/vercel-edge-config.md)                   | Basic        | Shows how to configure a FrontMCP server for Vercel deployment with Vercel KV for session storage and correct route configuration.                    |

> See all examples in [`examples/production-vercel/`](../examples/production-vercel/)
