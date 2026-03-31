---
name: production-cloudflare
description: Checklist for deploying FrontMCP to Cloudflare Workers with KV and Durable Objects
---

# Production Readiness: Cloudflare Workers

Target-specific checklist for deploying FrontMCP to Cloudflare Workers.

> Run the `common-checklist` first, then use this checklist for Cloudflare-specific items.

## Wrangler Configuration

- [ ] `wrangler.toml` is configured with correct routes and bindings
- [ ] `frontmcp build --target cloudflare` produces the correct output
- [ ] Environment variables are set via `wrangler secret put` or dashboard
- [ ] Custom domain or `*.workers.dev` subdomain is configured for CORS

## Workers Runtime

- [ ] No Node.js-only APIs used (Workers use V8 isolates, not Node)
- [ ] No `node:crypto` or `node:fs` — use `@frontmcp/utils` or Web APIs
- [ ] Bundle size is within Workers limits (< 10MB compressed)
- [ ] No `eval()` or dynamic `Function()` (prohibited in Workers)
- [ ] Async I/O only — no synchronous blocking operations

## Storage

- [ ] Session storage uses Workers KV, Durable Objects, or D1
- [ ] Cache uses Workers KV or Cache API
- [ ] No file system access (Workers have no filesystem)
- [ ] R2 is used for blob/file storage if needed

## Performance

- [ ] Cold start time is within Workers limits (< 50ms)
- [ ] No heavy initialization at module scope
- [ ] Lazy-load dependencies
- [ ] Request handling completes within CPU time limits

## Scaling

- [ ] Stateless design (Workers are ephemeral)
- [ ] Durable Objects used for stateful coordination (if needed)
- [ ] No in-memory caching between requests (use KV instead)

## CI/CD

- [ ] `wrangler.toml` environment configs for staging/production
- [ ] Secrets set via `wrangler secret put`
- [ ] Deploy with `wrangler deploy` (not manual upload)
- [ ] Tail logs: `wrangler tail` for production debugging

## Examples

| Example                                                                                           | Level        | Description                                                                                                                                               |
| ------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`durable-objects-state`](../examples/production-cloudflare/durable-objects-state.md)             | Advanced     | Shows how to use Cloudflare Durable Objects for stateful coordination alongside the stateless Workers runtime, with KV for cache and R2 for blob storage. |
| [`workers-runtime-constraints`](../examples/production-cloudflare/workers-runtime-constraints.md) | Intermediate | Shows how to write tools that are compatible with the Cloudflare Workers runtime: no Node.js APIs, no eval, only async I/O, and using Web APIs.           |
| [`wrangler-config`](../examples/production-cloudflare/wrangler-config.md)                         | Basic        | Shows how to configure `wrangler.toml` with correct routes, KV bindings for session storage, and secret management for a FrontMCP Cloudflare Worker.      |

> See all examples in [`examples/production-cloudflare/`](../examples/production-cloudflare/)
