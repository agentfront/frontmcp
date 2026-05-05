---
name: vercel-edge-config
reference: production-vercel
level: basic
description: '> Configuration authoring lives in **`frontmcp-deployment` → `references/deploy-to-vercel.md`**. This file is checklist-only: it verifies the artifact produced by `frontmcp build --target vercel` is production-ready.'
tags:
  - production
  - vercel-kv
  - vercel
  - session
  - serverless
  - checklist
features:
  - Verify `frontmcp build --target vercel` produced `.vercel/output/functions/index.func/handler.cjs`
  - No hand-written `vercel.json` `builds`/`routes` — the build adapter uses Build Output API v3
  - "Verify Vercel KV (`provider: 'vercel-kv'`) is configured for session/cache state"
  - Verify CORS origins include `VERCEL_URL` and any custom production domain
---

# Vercel Deployment: Production-Readiness Checklist

> Configuration authoring lives in **`frontmcp-deployment` → `references/deploy-to-vercel.md`**. This file is checklist-only: it verifies the artifact produced by `frontmcp build --target vercel` is production-ready.

## Build artifact checks

- [ ] `frontmcp build --target vercel` completed without warnings
- [ ] `.vercel/output/config.json` exists (Build Output API v3 — `version: 3`)
- [ ] `.vercel/output/functions/index.func/handler.cjs` exists — this is the actual function bundle
- [ ] `.vercel/output/functions/index.func/.vc-config.json` declares `runtime: nodejs24.x` (the default written by the build adapter) and `handler: "handler.cjs"`
- [ ] No hand-written `vercel.json` with the obsolete `{ "builds": [...], "routes": [...] }` shape — modern adapter emits `{ "version": 2, "buildCommand": ..., "installCommand": ... }` and routes through Build Output API
- [ ] No hand-written `src/lambda.ts` / `api/mcp.ts` with a fictional `createVercelHandler(...)` import — the build adapter generates `index.js` that requires your decorated `@FrontMcp` class

## Runtime config (`@FrontMcp` decorator)

- [ ] `redis: { provider: 'vercel-kv' }` for session/cache state (in-memory is per-invocation only)
- [ ] `cors.origin` is an explicit allowlist (`VERCEL_URL`, custom domain) — never `*` in production
- [ ] No SQLite usage (no persistent filesystem on Vercel functions)
- [ ] No `setInterval` / background timers — they don't survive freeze

## Cold-start budget

- [ ] No top-level `await` in `src/main.ts`
- [ ] Heavy SDKs are lazy-imported (`await import('...')`)
- [ ] Cold start under your function `maxDuration` budget on first request

## Env & secrets

- [ ] All required env vars set in Vercel project settings (`Production` + `Preview` scopes)
- [ ] No secrets committed to `vercel.json` or `.env`
- [ ] `KV_REST_API_URL` / `KV_REST_API_TOKEN` linked from the KV integration

## Deploy & monitoring

- [ ] Preview deployment exercises the full MCP flow (init → `tools/list` → `tools/call`)
- [ ] `vercel --prod` deploy succeeds and the function appears in the dashboard
- [ ] Function logs show no warnings on cold start

## What This Demonstrates

- Verify `frontmcp build --target vercel` produced `.vercel/output/functions/index.func/handler.cjs`
- No hand-written `vercel.json` `builds`/`routes` — the build adapter uses Build Output API v3
- Verify Vercel KV (`provider: 'vercel-kv'`) is configured for session/cache state
- Verify CORS origins include `VERCEL_URL` and any custom production domain

## Related

- Configuration source of truth: `frontmcp-deployment/references/deploy-to-vercel.md`
- Build adapter source: `libs/cli/src/commands/build/adapters/vercel.ts`
- See `production-vercel` for the edge-runtime / scaling checklist
