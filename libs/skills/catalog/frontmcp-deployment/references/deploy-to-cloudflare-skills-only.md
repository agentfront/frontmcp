---
name: deploy-to-cloudflare-skills-only
description: Deploy an auto-updating FrontMCP server to Cloudflare Workers with @frontmcp/edge createEdgeMcp — managed skilled-OpenAPI bundle pulled from a SaaS endpoint, cached in KV, refreshed on a Cron Trigger or pushed to the Worker
---

# Deploy to Cloudflare Workers (Managed / Skills-Only Model)

> **⚠️ Status — experimental.** `@frontmcp/edge` `createEdgeMcp` **boots under
> `wrangler dev` and deploys and serves on real Cloudflare**, managed mode
> included, with no bundler stubs: since 1.9.1 wrangler resolves the SDK's
> `browser` build, and `createEdgeMcp` sets `serve: false` itself. The managed
> e2e bundles its Worker with `wrangler deploy --dry-run` and runs it in workerd
> (Miniflare): the pull, the Cron refresh, pushes and `run_workflow` calls.
> Managed mode (this page) needs a SaaS bundle
> endpoint; `@frontmcp/plugin-skilled-openapi` is a dependency of
> `@frontmcp/edge`, installed with it. A config that fails validation answers
> `500 CONFIG_INVALID` and the worker log names the invalid fields. For the
> simplest production path, the decorator build in
> [`deploy-to-cloudflare.md`](./deploy-to-cloudflare.md) needs none of this.
> The GitHub Action / `POST /_frontmcp/resync` / Durable Object stores / Frontegg
> edge auth described below remain ROADMAP — not yet implemented. Pushing a
> bundle to `POST /__skilled_openapi/push` (`managed.enableWebhook`) is implemented.

The managed model hosts FrontMCP where the MCP surface is a small set of
meta-tools (`search_skill`, `load_skill`, `execute_action`, `run_workflow`) and
every capability is reached through a skill compiled from an OpenAPI spec.
`execute_action` runs one action of a loaded skill, `{ actionId, input }`, with
no script and no sandbox. `run_workflow` chains several: it runs a short
AgentScript program in the Worker isolate, where each `callTool(actionId,
input)` invokes a loaded skill's operation. The bundle is pulled from a SaaS
endpoint, cached in KV, and refreshed on a Cron Trigger; with
`managed.enableWebhook`, the SaaS can also push a new bundle to the Worker.

A failed call throws an error that names the API's status and error body
(compacted JSON or text, redacted, cut at 2 KB), such as `action
"refundInvoice" failed with status 422: {"error":"refund_too_large"}`;
`outbound.errorBodies: 'status-only'` names the status alone. `callTool(actionId,
input, { throwOnError: false })` returns `{ ok, status, data }` instead, `data`
being the error body on a failure and `status` 0 (with an `error`) when no
answer came. A workflow that fails is an `isError: true` result with the same
`structuredContent`. Up to 1.11.0 the error named the status alone, and the
result had no `isError`. A failed `execute_action` is an `isError: true` result
whose text is that same error and whose `structuredContent` is the `{ ok:
false, status, data?, error? }` outcome; on success its `structuredContent` is
the action's data. Managed mode doesn't set the plugin's `confirm` option, so
no action asks the user first; a server built with `SkilledOpenApiPlugin.init({
confirm })` and `elicitation: { enabled: true }` can make actions ask.

The meta-tools only show what the caller may use: a skill whose
`requiredAuthorities` the caller doesn't satisfy is left out of `search_skill`
(and its catalog) and is `SKILL_NOT_FOUND` for `load_skill`, and `load_skill`
leaves out actions the caller can never run. When the server configures
`authorities`, bundle rules are evaluated with the server's engine (its
`claimsMapping`, resolvers and custom evaluators). An operation that several
skills list runs when the caller satisfies the operation's rule and the rule of
any one of those skills, whatever the order of the skills in the bundle. A rule
that depends on the action's input is judged only at the call, so `load_skill`
can list an action that the call then refuses.

A bundle skill's `SKILL.md` is listed in `skill://index.json` at its name
(`skill://Invoices/SKILL.md`, as SEP-2640 requires) and is also served at the
same URI with its id (`skill://invoices/SKILL.md`), the id the meta-tools and
`skills/list` report, with the same gating. `skills/list` and `skills/search`
report each bundle skill's `bundleVersion` too, as `search_skill` does. A skill whose id is another
skill's name is refused, so an id names one skill: a bundle with one is not
applied and the previous bundle stays active. The previous bundle's skills do
not count, so a new skill can take the name of a skill the bundle drops or
renames (`registerSkillContent`'s `supersedes` option, which the bundle sync
fills in).

A bundle skill's `SKILL.md` ends with an `## Actions` section listing the
actions the caller may run, as `load_skill` does: each action's id, summary,
description, and input and output JSON Schemas, after a line on running one
with `execute_action` or chaining several with `run_workflow`. Up to 1.11.0 it had the instructions only, so a client
that read the resource had to call `load_skill` to learn the actions.

For the conceptual picture, see [Skills-Only Deployment](https://frontmcp.dev/reference/sdk/skill#connecting-for-skills-only).
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
import { env } from 'cloudflare:workers';

import { createEdgeMcp, kvBundleCacheFromEnv } from '@frontmcp/edge';

export default createEdgeMcp({
  info: { name: 'my-worker', version: '1.0.0' },
  apps: [],
  tasks: { enabled: false },
  managed: {
    endpoint: 'https://cloud.example.com/v1/bundles/acme',
    // The pull JWT the SaaS issued for this server (iss = expectedIssuer, aud includes
    // expectedAudience, with exp), kept in a Worker secret:
    //   npx wrangler secret put FRONTMCP_PULL_TOKEN
    authToken: env.FRONTMCP_PULL_TOKEN,
    expectedAudience: 'acme-mcp',
    jwksUrl: 'https://cloud.example.com/.well-known/jwks.json',
    expectedIssuer: 'https://cloud.example.com',
    // KV cache of the last bundle applied, resolved from the per-request `env`.
    cache: kvBundleCacheFromEnv('BUNDLE_CACHE'),
  },
});
```

`createEdgeMcp` returns `{ fetch, scheduled }`: `fetch` serves MCP; `scheduled`
is the **Cron Trigger** entrypoint that pulls a fresh bundle and hot-swaps it.
The Cron run ends once that bundle is applied and kept in the KV cache, also
when it is the first event an isolate gets (it starts the bundle sync, whose
first pull is the run's pull). The cache only ever holds a bundle the Worker
applied: one that fails its signature or schema check is not applied and not
kept, so a cold start that can't pull serves the last bundle applied.
Bundles only move forward: a pulled or pushed bundle older than the one the
isolate serves is not applied and not kept (logged as `[bundle-sync] bundle
<id>@<version> not applied: older than the served bundle ...`), so a validly
signed old bundle can't roll the Worker back. Two semver versions compare by
semver; the same version (re-signed), or versions that aren't both semver,
compare by `generatedAt`. To roll back, publish the earlier content under a
newer version, or set `managed.allowRollback: true`. An isolate that starts
has no bundle to compare with: it serves what it pulls, or the KV cache when
the pull fails.
A Cron run whose sync leaves an older bundle serving **fails**: `scheduled`
throws, so Cloudflare logs the run as an exception and counts it as a failed
invocation. That is a pulled bundle that is not applied (`[frontmcp/edge] Cron
refresh: bundle <id>@<version> was not applied: <reason>`), or a pull that
fails (`... the bundle pull failed: <reason>`), also when the run started the
isolate and it serves the KV cache (`... failed, so the cached bundle serves:
<reason>`). Up to 1.11.0 such a run reported success. With
`health: { readyz: { enabled: true } }` (off on a Worker by default), `/readyz`
stays ready while the last good bundle serves, and its `skilled-openapi` check
is `degraded` with `details: { state: 'stale', bundleId, bundleVersion,
lastSync: { status: 'refused' | 'failed', reason, at, ... } }`. Each isolate
answers for its own bundle.
A `run_workflow` already running when the new bundle is applied finishes on the operations of the bundle it started on.
Managed mode runs on `@frontmcp/plugin-skilled-openapi`, which `@frontmcp/edge` depends on. When the boot pull fails and the KV cache is empty, the error says no bundle is available in the injected bundle cache (no file path), and `search_skill`, `load_skill` and `run_workflow` answer `No skill bundle is loaded: <that reason>` (code `SKILL_BUNDLE_NOT_LOADED`, `_meta.retryable: true`) until a Cron refresh loads a bundle. The SDK's skill surfaces answer the same, as a JSON-RPC error with `data: { code: 'SKILL_BUNDLE_NOT_LOADED', retryable: true }`: `skills/list`, `skills/search` and `skill://index.json`, and `skills/load` or a `SKILL.md` read of a skill not found. `initialize` says the skills have not loaded yet. A stateless request, which skips `initialize`, starts the pull and gets the same answer. Up to 1.11.0 they answered as if the server had no skills.
Its `outbound.egressProxy` option needs Node.js (undici's `ProxyAgent`); on a
Worker a configured proxy makes every operation call fail with
`egress proxy unavailable`, so leave it unset there.

The pull sends `authToken` as a bearer token and never follows a redirect, so
`endpoint` must serve the bundle directly; a 3xx (or a status-0
`opaqueredirect`) fails the pull.

Before every pull, `authToken` itself is verified: it must be a JWT signed by a
key served at `jwksUrl` (fetched without the token, redirects refused), with
`iss` equal to `expectedIssuer`, an `aud` that includes `expectedAudience` (and
a `resource` claim that does too, when it has one), and not expired. A token
that fails is refused with `[saas-source] pull token rejected: …`: nothing is
pulled, and the KV cache is **not** used in its place. An unreachable JWKS, or
one with no usable signing key (no RSA, EC or OKP public key for signatures),
counts as an ordinary pull failure, so the cache fallback still applies.

The log and `/readyz` name the check that failed, as `tokenFailure`: `expired`,
`not_yet_valid`, `wrong_issuer`, `wrong_audience`, `unknown_key` (a `kid` the
JWKS doesn't publish), `bad_signature`, `unsupported_algorithm`,
`missing_claim`, `malformed`, `body_mismatch` (a push token issued for another
body), or `jwks_unavailable` (not checked: the JWKS couldn't be read). A pull logs `[saas-source] saas:<endpoint>: pull token check
failed (expired)` at warn level, never the token; the check has it in
`details.lastSync.tokenFailure`, and a failed Cron run's error says
`the bundle pull failed (token check: expired): …`. The tools'
`SKILL_BUNDLE_NOT_LOADED` reason doesn't name it.

On a Worker, the outbound check of each operation call resolves the API's host
with workerd's `node:dns`, which asks DNS over HTTPS (`cloudflare-dns.com`): the
host must resolve publicly, and a name that resolves to a private address is
refused as on Node.

## Pushed Bundles

With `enableWebhook: true` in `managed`, the Worker also takes bundles at
`POST /__skilled_openapi/push`, through the hookable
`skilled-openapi:bundle-push` flow (IP filter and rate limit first, as every
HTTP flow). The request:

- `Authorization: Bearer <JWT>`: checked as `authToken` is (a key at
  `jwksUrl`, `iss`, `aud`, `resource`, `exp`), and it must also carry a `jti`
  of 8 or more characters that no push used and an `iat` within five minutes,
  so the pull token, issued long before, can't push;
- a `body_sha256` claim in that token: the base64url SHA-256, without
  padding, of the exact bytes of the request body (not the bundle's
  `integrity.digest`), so a captured token can't carry another bundle;
- the body: the bundle as JSON, checked as a pulled bundle is (schema, then
  signature against `trustedKeys` unless `requireSignature: false`).

The Worker hashes the bytes it received, not a re-serialization of the JSON:
any other body, even the same bundle with other whitespace, answers `401`, and
the log says `[saas-source] push refused (body_mismatch): …`. The refused
token's `jti` stays unused, so the push it was issued for still applies. A
token without `body_sha256` is accepted, with one warning per isolate, so a
SaaS that doesn't set it yet keeps working; `managed.requirePushBodyDigest:
true` refuses it (logged as `missing_claim`). On Node, the `saas` source takes
the same `requirePushBodyDigest` option. A sender computes the claim with
`pushBodyDigest(body)` from `@frontmcp/adapters/skills`, over the string it
sends:

```ts
import { PUSH_BODY_DIGEST_CLAIM, pushBodyDigest } from '@frontmcp/adapters/skills';

const body = JSON.stringify(signedBundle);
const claims = { jti: randomUUID(), [PUSH_BODY_DIGEST_CLAIM]: pushBodyDigest(body) };
// sign `claims` as a push token (iss, aud, iat, a short exp), then POST `body` with it
```

| Answer | When                                                                                       |
| ------ | ------------------------------------------------------------------------------------------ |
| `200`  | `{ applied: true, bundleId, bundleVersion }`: applied, and kept in the KV cache            |
| `400`  | `invalid_bundle`: the body is not a bundle                                                 |
| `401`  | `invalid_token`, with `WWW-Authenticate: Bearer error="invalid_token"`                     |
| `409`  | `push_replayed`: a push already used this token's `jti`                                    |
| `409`  | `bundle_outdated`: older than the bundle being served, which stays                         |
| `422`  | `bundle_not_applied`: the signature or the bundle's checks failed; the served bundle stays |
| `503`  | `temporarily_unavailable`: the JWKS could not be read, or the `jti` could not be recorded  |

A refused push token answers the same `401` whatever check refused it; only
the log names it: `[saas-source] push refused (wrong_issuer): …`, or
`bundle push not checked (jwks_unavailable): …` for the `503`. A pushed bundle
is applied after the first pull and after bundles already queued, so a push and
a Cron refresh never apply at once.

The replay guard keeps the `jti`s in a Durable Object that every isolate and
replica of the Worker reaches, so a push replayed to another isolate is refused
with `409 push_replayed` too. KV can't guard replays: it is eventually
consistent, so two isolates could both read a `jti` as unused. Export the class
and bind it (default binding `FRONTMCP_PUSH_REPLAY`; `managed.pushReplay:
{ binding }` changes it):

```ts
const mcp = createEdgeMcp({ /* ..., */ managed: { /* ..., */ enableWebhook: true } });
export default mcp;
export const FrontMcpPushReplay = mcp.PushReplayDurableObject;
```

Each `jti` is kept, in one object per `expectedAudience`, until its token's
`iat` is five minutes old. Without the binding, every push answers `503
temporarily_unavailable` and the log names the missing binding; pulls and Cron
runs are not affected. Up to 1.11.0 the `jti`s were kept in each isolate's
memory. On Deno or Bun, `managed.pushReplay` can be a function of `env` that
returns a store `{ claim(key, ttlMs) }` (`true` when it recorded `key`, `false`
when it is already recorded, throws when it can't tell).

On Node, the plugin keeps the `jti`s in the process's memory by default; with
several replicas, set the `saas` source's `pushReplayStorage` to a shared store
(`{ type: 'redis', redis: { url } }`, or `upstash`, `vercel-kv`, `sqlite`).

This path is bundled by **wrangler** (not `frontmcp build`), so you maintain
`wrangler.toml` yourself — it needs a `[[kv_namespaces]] binding = "BUNDLE_CACHE"`
and a `[triggers] crons = [...]` (the `managed.pollIntervalMs` option is
ignored on edge — Workers have no background timers; the Cron drives refresh),
and with `enableWebhook` the push replay Durable Object and its migration:

```toml
name = "my-worker"
main = "worker.ts"
compatibility_date = "2024-11-11"
compatibility_flags = ["nodejs_compat"]

[[kv_namespaces]]
binding = "BUNDLE_CACHE"
id = "<your-kv-namespace-id>"

# with managed.enableWebhook
[[durable_objects.bindings]]
name = "FRONTMCP_PUSH_REPLAY"
class_name = "FrontMcpPushReplay"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["FrontMcpPushReplay"]

[triggers]
crons = ["*/5 * * * *"]
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
   - Emit one notifications/{skills,tools,resources,prompts}/list_changed per list that changed
   - Persist envelope into BUNDLE_CACHE KV
```

Day-to-day skill / OpenAPI edits are pure hot-reload. `wrangler deploy` is only needed for structural changes.

## Isolation Strategy

`codecall:execute` runs agent-authored AgentScript inside the Worker isolate. Two layers:

1. **AST preflight on every call** via `@enclave-vm/ast` (pure-JS, Acorn-based, Worker-safe). Rejects `eval`, `Function`, `process`, `require`, dynamic `import`, raw `fetch`, prototype-walks, etc. before the script runs.
2. **Frozen capability scope.** Script executes with `new Function('skills', 'ctx', code)` against a frozen object that holds only the active skills' generated namespaces + `callTool` / `getTool` / `mcpLog` / `mcpNotify`.

`@enclave-vm/core` (full VM) needs `node:vm` and is NOT Worker-safe — the Worker target uses AST-preflight + frozen scope only.

## Auth at the Edge 🚧 Roadmap — not yet implemented

> The Frontegg **edge** JWT verification below is a ROADMAP shape, not a shipped
> feature. Don't wire it expecting edge-native verification today; use the
> standard auth providers via the decorator build until this lands.

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

## Sample `.github/workflows/deploy.yml` 🚧 Roadmap — not yet implemented

> The packaged GitHub Action and the signed-resync webhook are ROADMAP. The
> workflow below is an illustrative target, not a copy-paste-ready pipeline —
> deploy manually with `wrangler deploy` until the Action ships.

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
- **Wrapping `callTool` in `try`/`catch`.** AgentScript has none (`Unsupported statement: TryStatement`). Pass `{ throwOnError: false }` and branch on `ok` and `status`.
- **Expecting the API's error body with `outbound.errorBodies: 'status-only'`.** With it, the thrown error names the status alone, and a `{ throwOnError: false }` result has no `data`.

## See Also

- `references/deploy-manifest-yaml.md` — full `frontmcp.deploy.yaml` schema reference
- `references/deploy-to-cloudflare.md` — the older Express-to-Workers adapter path
- `references/wrangler-config.md` — wrangler.toml checklist
- Docs: https://frontmcp.dev/reference/deployment/cloudflare-workers
- Docs: https://frontmcp.dev/reference/sdk/skill#connecting-for-skills-only
