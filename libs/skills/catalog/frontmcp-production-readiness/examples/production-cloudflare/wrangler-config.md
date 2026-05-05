---
name: wrangler-config
reference: production-cloudflare
level: basic
description: 'Checklist for verifying the `wrangler.toml` produced by `frontmcp build --target cloudflare` is production-ready. **Note:** configuration authoring lives in `frontmcp-deployment → references/deploy-to-cloudflare.md`; this file is checklist-only.'
tags:
  - production
  - cloudflare
  - cache
  - session
  - wrangler
  - checklist
features:
  - Verify `main = "dist/cloudflare/index.js"` (the build adapter writes this — never override)
  - Verify KV bindings for sessions and cache exist
  - Verify staging / production environment configs are separated
  - Verify secrets are NOT in `wrangler.toml` — use `wrangler secret put`
---

# Wrangler Configuration: Production-Readiness Checklist

Checklist for verifying the `wrangler.toml` produced by `frontmcp build --target cloudflare` is production-ready. **Note:** configuration authoring lives in `frontmcp-deployment → references/deploy-to-cloudflare.md`; this file is checklist-only.

## Build artifact checks

- [ ] `frontmcp build --target cloudflare` runs cleanly with no warnings
- [ ] The build adapter wrote `main = "dist/cloudflare/index.js"` to `wrangler.toml` — **do not hand-edit this line**; the adapter overwrites it on every build (PR #374 — overriding silently breaks `wrangler deploy`)
- [ ] `dist/cloudflare/index.js` exists after build and is what `wrangler deploy` uploads
- [ ] No hand-written `src/worker.ts` with a fictional `createCloudflareHandler(...)` — the build emits the entry; your code stays the decorated `@FrontMcp` class
- [ ] Bundle size is < 10 MB compressed (Workers limit)

## Routes & domains

- [ ] `routes = [{ pattern = "<host>/*", zone_name = "<zone>" }]` set for the right hostnames
- [ ] Custom domain or `*.workers.dev` subdomain matches what `cors.origin` accepts in your `@FrontMcp` config
- [ ] Separate `[env.staging]` and `[env.production]` blocks with distinct names + routes

## KV / Durable Objects / R2

- [ ] At least one `[[kv_namespaces]]` block bound for sessions if HA / multi-region (e.g. `binding = "MCP_SESSIONS"`)
- [ ] Cache binding (KV or Cache API) exists if `CachePlugin` is configured
- [ ] Durable Objects only used when stateful coordination is required (rate limiting, locks)
- [ ] R2 binding exists if the server reads/writes blobs (no filesystem in Workers)

## Secrets & environment

- [ ] No secrets in `wrangler.toml` — all set via `wrangler secret put <NAME>`
- [ ] `[vars]` block contains only non-sensitive config (region names, feature flags)
- [ ] `compatibility_date` set to a recent date and locked

## Deploy & observability

- [ ] Deploy with `wrangler deploy --env production` (not the unscoped form)
- [ ] `wrangler tail` works against the production worker for live debugging
- [ ] Dashboard shows recent successful deploys

## What This Demonstrates

- Verify `main = "dist/cloudflare/index.js"` (the build adapter writes this — never override)
- Verify KV bindings for sessions and cache exist
- Verify staging / production environment configs are separated
- Verify secrets are NOT in `wrangler.toml` — use `wrangler secret put`

## Related

- Configuration source of truth: `frontmcp-deployment/references/deploy-to-cloudflare.md`
- Build adapter source: `libs/cli/src/commands/build/adapters/cloudflare.ts`
- See `production-cloudflare` for the Cloudflare runtime / scaling checklist
