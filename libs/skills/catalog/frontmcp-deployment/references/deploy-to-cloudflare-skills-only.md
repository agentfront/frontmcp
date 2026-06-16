---
name: deploy-to-cloudflare-skills-only
description: Deploy a FrontMCP server to Cloudflare Workers using the v1.3 skills-only model — OpenAPI as capability inventory, AgentScript with namespaced bindings, four meta-tools, hot-reload via GitHub Action and a signed-bundle webhook
---

# Deploy to Cloudflare Workers (Skills-Only Model)

The v1.3 Cloudflare Worker target hosts FrontMCP as a control plane where the MCP surface is just **four meta-tools** (`searchSkills`, `searchKnowledge`, `describe`, `execute`) and every capability is reached through a skill. OpenAPI specs ship to the project but are NEVER directly exposed — they are the capability inventory, classified by HTTP semantics into resources / tools, with auto-derived `notifications/resources/*` events.

For the conceptual picture, see [Skills-Only Deployment](https://docs.agentfront.dev/frontmcp/features/skills-only-deployment).
For the older Express-to-Workers adapter, see [`deploy-to-cloudflare.md`](./deploy-to-cloudflare.md).

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
// worker.ts (~10 lines)
import { createWorker } from '@frontmcp/edge';

import deployBundle from './frontmcp.deploy.bundle.js'; // emitted by the GH Action

const { handler, durableObjects } = createWorker({
  bundle: deployBundle,
  env: 'production',
});

export default handler;
export const { SessionDO, EventStoreDO, BundleDO } = durableObjects;
```

`createWorker` parses the manifest, applies the `environments.production` overlay, verifies the signed envelope against `TRUSTED_KEYS`, and assembles the FrontMCP runtime.

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
