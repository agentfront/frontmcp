---
name: deploy-to-cloudflare-skills-only
description: Deploy an auto-updating FrontMCP server to Cloudflare Workers with @frontmcp/edge createEdgeMcp — managed skilled-OpenAPI bundle pulled from a SaaS endpoint, cached in KV, refreshed on a Cron Trigger
---

# Deploy to Cloudflare Workers (Managed / Skills-Only Model)

> **⚠️ Status — experimental.** `@frontmcp/edge` `createEdgeMcp` **deploys and
> serves on real Cloudflare** (verified live), as long as you (1) keep
> `serve: false` (now the createEdgeMcp default) and (2) stub three Node-only
> transports your bundler statically includes but the edge never uses —
> `express`, `raw-body`, `cross-spawn`. NOTE: **miniflare local-dev is stricter
> than production** and rejects `node:http2`/`node:fs` that real Cloudflare's
> `nodejs_compat` provides, so the local managed e2e is skipped even though the
> package runs in production. Managed mode (this page) additionally needs a SaaS
> bundle endpoint + the optional peer `@frontmcp/plugin-skilled-openapi`. The
> worker-conditioned SDK build (roadmap) removes the manual stubs. For the
> simplest production path, the decorator build in
> [`deploy-to-cloudflare.md`](./deploy-to-cloudflare.md) needs none of this.
> The GitHub Action / signed-resync-webhook / Durable Object stores / Frontegg
> edge auth described below remain ROADMAP — not yet implemented.

The managed model hosts FrontMCP where the MCP surface is a small set of
meta-tools (`search_skill`, `load_skill`, `run_workflow`) and every capability
is reached through a skill compiled from an OpenAPI spec. `run_workflow` runs a
short AgentScript program in the Worker isolate, where each `callTool(actionId,
input)` invokes a loaded skill's operation. The bundle is pulled from a SaaS
endpoint, cached in KV, and refreshed on a Cron Trigger.

For the conceptual picture, see [Skills-Only Deployment](https://docs.agentfront.dev/frontmcp/features/skills-only-deployment).
For the production-ready decorator build, see [`deploy-to-cloudflare.md`](./deploy-to-cloudflare.md).

## When to Use This Skill

### Must Use

- Deploying a FrontMCP server using the v1.3 skills-only model on Cloudflare
- Setting up GitHub-Action-driven hot-reload of skills + OpenAPI specs without a wrangler redeploy on every push
- Configuring AgentScript with namespaced OpenAPI bindings (`acme.getUser({...})`)

### Recommended

- Standing up the first hosted FrontMCP runtime
- Migrating from the flat-tools model to skills-only

### Skip When

- You want a long-running Node process — use `deploy-to-node`
- You need the full `@enclave-vm/core` CodeCall VM (pause / rerun) — host on Node; the Worker uses AST-preflight only
- You're shipping `scripts/` skill blobs (Anthropic Agent Skills spec) — that ships in v1.7

## Worker Entry File

```ts
// worker.ts — the real API is createEdgeMcp (not createWorker)
import { createEdgeMcp, kvBundleCacheFromEnv } from '@frontmcp/edge';

export default createEdgeMcp({
  info: { name: 'my-worker', version: '1.0.0' },
  apps: [],
  tasks: { enabled: false },
  managed: {
    endpoint: 'https://cloud.example.com/v1/bundles/acme',
    authToken: 'pinned-pull-token',
    expectedAudience: 'acme-mcp',
    jwksUrl: 'https://cloud.example.com/.well-known/jwks.json',
    expectedIssuer: 'https://cloud.example.com',
    // KV-backed last-good cache, resolved from the per-request `env`.
    cache: kvBundleCacheFromEnv('BUNDLE_CACHE'),
  },
});
```

`createEdgeMcp` returns `{ fetch, scheduled }`: `fetch` serves MCP; `scheduled`
is the **Cron Trigger** entrypoint that pulls a fresh bundle and hot-swaps it.
Managed mode requires the optional peer `@frontmcp/plugin-skilled-openapi`.

This path is bundled by **wrangler** (not `frontmcp build`), so you maintain
`wrangler.toml` yourself — it needs a `[[kv_namespaces]] binding = "BUNDLE_CACHE"`
and a `[triggers] crontabs = [...]` (the `managed.pollIntervalMs` option is
ignored on edge — Workers have no background timers; the Cron drives refresh):

```toml
name = "my-worker"
main = "worker.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[[kv_namespaces]]
binding = "BUNDLE_CACHE"
id = "<your-kv-namespace-id>"

[triggers]
crontabs = ["*/5 * * * *"]
```

## Storage Layout (Opinionated Default)

| Binding        | Class / kind        | Purpose                                                     |
| -------------- | ------------------- | ----------------------------------------------------------- |
| `SESSIONS`     | DO (`SessionDO`)    | MCP session store; survives Worker restarts                 |
| `EVENTS`       | DO (`EventStoreDO`) | Event store for Streamable HTTP + SSE resumability          |
| `BUNDLE`       | DO (`BundleDO`)     | Last-good envelope + active classifications (hot-swappable) |
| `AUDIT`        | D1                  | Hash-chained skill action audit log (v1.2 audit spec)       |
| `BUNDLE_CACHE` | KV                  | Fallback bundle reused if a resync push fails               |
| `REPLAY_NONCE` | KV                  | Replay-guard nonce dedupe (`signing.replay.windowSeconds`)  |
| `SKILL_DATA`   | R2                  | Large skill `data/` blobs                                   |

## Hot-Reload Cycle

```text
GitHub push → frontmcp/deploy-action@v1
   1. Parse + cross-validate frontmcp.deploy.yaml
   2. Apply environments.<env> overlay
   3. Walk skills/; run the markdown op-reference harvester
   4. Run the OpenAPI → MCP classifier
   5. Inline & content-address artifacts
   6. Sign envelope (Ed25519 by default)
   7. POST → worker/_frontmcp/resync
            ↓
Worker:
   - Verify signature against signing.trustRoots[].publicKeySecret
   - Replay-guard via REPLAY_NONCE KV
   - Diff: structural change (DO classes, bindings) → require redeploy
   - Otherwise: atomic swap of skill + classification registries
   - Emit notifications/{skills,tools,resources,prompts}/list_changed
   - Persist envelope into BUNDLE_CACHE KV
```

Day-to-day skill / OpenAPI edits are pure hot-reload. `wrangler deploy` is only needed for structural changes.

## Isolation Strategy

`codecall:execute` runs agent-authored AgentScript inside the Worker isolate. Two layers:

1. **AST preflight on every call** via `@enclave-vm/ast` (pure-JS, Acorn-based, Worker-safe). Rejects `eval`, `Function`, `process`, `require`, dynamic `import`, raw `fetch`, prototype-walks, etc. before the script runs.
2. **Frozen capability scope.** Script executes with `new Function('skills', 'ctx', code)` against a frozen object that holds only the active skills' generated namespaces + `callTool` / `getTool` / `mcpLog` / `mcpNotify`.

`@enclave-vm/core` (full VM) needs `node:vm` and is NOT Worker-safe — the Worker target uses AST-preflight + frozen scope only.

## Auth at the Edge

```yaml
auth:
  provider: frontegg
  frontegg:
    tenantResolver: subdomain
    audience: acme-mcp
    issuerSecret: FRONTEGG_ISSUER_URL
```

Frontegg JWT verification runs at the Worker edge — no upstream hop. Other providers (`oauth`, `apiKey`, `none`) share the same shape.

## Secrets

Names-only in the manifest:

```yaml
secrets:
  - { name: TRUSTED_PUBKEY_PROD, required: true, description: 'Signing trust root (PEM)' }
  - { name: FRONTEGG_ISSUER_URL, required: true }
  - { name: ACME_API_TOKEN, required: true }
```

Bind values out-of-band:

```bash
wrangler secret put TRUSTED_PUBKEY_PROD
wrangler secret put FRONTEGG_ISSUER_URL
wrangler secret put ACME_API_TOKEN
```

The cross-validator REJECTS any manifest that references a secret name not declared in `secrets[]`.

## Sample `.github/workflows/deploy.yml`

```yaml
name: Deploy
on:
  push: { branches: [main] }
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@v6
      - uses: frontmcp/deploy-action@v1
        with:
          environment: production
          signingKey: ${{ secrets.FRONTMCP_SIGNING_KEY }}
          secrets: |
            TRUSTED_PUBKEY_PROD
            FRONTEGG_ISSUER_URL
            ACME_API_TOKEN
        env:
          TRUSTED_PUBKEY_PROD: ${{ secrets.TRUSTED_PUBKEY_PROD }}
          FRONTEGG_ISSUER_URL: ${{ secrets.FRONTEGG_ISSUER_URL }}
          ACME_API_TOKEN: ${{ secrets.ACME_API_TOKEN }}
```

Action outputs:

- `deployment-url` — the Worker URL
- `bundle-sha256` — content-addressed envelope digest (pin in release notes)

## Common Mistakes

- **Embedding secrets in `wrangler.toml` or the deploy YAML.** The cross-validator + schema both reject inline secret values. Always `wrangler secret put`.
- **Using `wrangler deploy` for every push.** Once the Worker has its DO + KV + D1 bindings, day-to-day skill changes flow through `POST /_frontmcp/resync`. Only structural changes need a redeploy.
- **Forgetting to declare `signing.replay.nonceKv`.** The cross-validator requires the value to match a binding in `bindings.kvNamespaces[]`. Without it the Worker can't dedupe replays.
- **Mixing `acme-api` as both a spec id AND an AgentScript namespace.** Dashes aren't valid JS identifiers — add `bindingName: acmeApi` on the spec entry, or rename the spec.
- **Assuming `notifications/resources/updated` carries no URI.** It does — `notifications/resources/list_changed` is the one with empty params.

## See Also

- `references/deploy-manifest-yaml.md` — full `frontmcp.deploy.yaml` schema reference
- `references/deploy-to-cloudflare.md` — the older Express-to-Workers adapter path
- `references/wrangler-config.md` — wrangler.toml checklist
- Docs: https://docs.agentfront.dev/frontmcp/deployment/cloudflare-worker
- Docs: https://docs.agentfront.dev/frontmcp/features/skills-only-deployment
