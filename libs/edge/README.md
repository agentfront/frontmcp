# @frontmcp/edge

Run a FrontMCP server on Cloudflare Workers from a plain configuration object. The Worker's entry file calls `createEdgeMcp()` with the configuration you'd give `@FrontMcp` and exports what it returns; `wrangler` bundles that file as it is, with no `frontmcp build` step and no `@FrontMcp` class. Compared with `frontmcp build --target cloudflare`, it adds sessions kept in a Durable Object and a managed mode that pulls a Skilled OpenAPI bundle, refreshes it from a Cron Trigger, and can take bundles pushed to it.

[![npm](https://img.shields.io/npm/v/@frontmcp/edge.svg)](https://www.npmjs.com/package/@frontmcp/edge) [![License](https://img.shields.io/npm/l/@frontmcp/edge.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

```bash
npm install @frontmcp/edge @frontmcp/sdk
npm install -D wrangler
```

`@frontmcp/sdk` is a peer dependency. `@frontmcp/plugin-skilled-openapi`, which managed mode uses, is a dependency, so it's installed with this package. Install with Node.js 24 or later.

## Usage

```ts
// src/worker.ts
import { createEdgeMcp } from '@frontmcp/edge';
import { app, tool, z } from '@frontmcp/sdk';

const searchTickets = tool({
  name: 'search_tickets',
  description: 'Search tickets by title',
  inputSchema: { query: z.string() },
})(async ({ query }) => ({ query, tickets: [{ id: 'T-1', title: 'Cannot log in' }] }));

export default createEdgeMcp({
  info: { name: 'help-desk', version: '1.0.0' },
  apps: [app({ id: 'help-desk', name: 'Help Desk', tools: [searchTickets] })],
  http: { entryPath: '/mcp' },
});
```

```toml
# wrangler.toml
name = "help-desk"
main = "src/worker.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]
```

```bash
npx wrangler dev      # local
npx wrangler deploy   # ship
```

`nodejs_compat` is required, and so is `apps` (it may be empty when you list `tools` at the top level). `tool()` and `app()` define tools and apps without decorators; `@Tool` and `@App` classes work too.

What the handler does:

- **It builds the server on the first request**, not when the module loads, since a Worker can't do I/O then, and reuses it afterwards. A failed build answers `500` (a configuration fault) or `503` with `Retry-After`, and is tried again after a delay that doubles from 1 second up to 60.
- **It copies string bindings to `process.env`** on the first request (your `[vars]` and secrets), without replacing values already there. Other bindings, such as a KV namespace, reach tools as `this.workerEnv`.
- **It serves** MCP at `http.entryPath` (`/` by default) and `/healthz`, and `/readyz` with `health: { readyz: { enabled: true } }`.
- **Background tasks are off** on the edge; the server logs that and starts without them.
- **On Deno and Bun**, which pass `fetch` a second argument of their own, the handler reads the client IP from it.

## Sessions in a Durable Object

Without `sessions`, the Worker keeps no sessions: each request from a client on a protocol version before 2026-07-28 is served on its own (2026-07-28 needs no session). With `sessions: {}`, each session's requests go to a Durable Object named after the session id, which keeps that session's server and transport between requests. Export the class and bind it:

```ts
// src/worker.ts
import { createEdgeMcp } from '@frontmcp/edge';
import { app, tool, z } from '@frontmcp/sdk';

const searchTickets = tool({
  name: 'search_tickets',
  description: 'Search tickets by title',
  inputSchema: { query: z.string() },
})(async ({ query }) => ({ query, tickets: [] }));

const mcp = createEdgeMcp({
  info: { name: 'help-desk', version: '1.0.0' },
  apps: [app({ id: 'help-desk', name: 'Help Desk', tools: [searchTickets] })],
  http: { entryPath: '/mcp' },
  sessions: {}, // the Durable Object binding defaults to FRONTMCP_SESSIONS; set { binding } to change it
});

export default mcp;
export const FrontMcpSession = mcp.SessionDurableObject;
```

```toml
# wrangler.toml
[[durable_objects.bindings]]
name = "FRONTMCP_SESSIONS"
class_name = "FrontMcpSession"

[[migrations]]
tag = "v1"
new_classes = ["FrontMcpSession"]
```

If the binding isn't in `wrangler.toml`, the Worker serves requests without sessions.

## Managed mode

`managed` pulls a signed [Skilled OpenAPI](https://frontmcp.dev/reference/plugins/skilled-openapi) bundle (OpenAPI specs compiled into MCP skills and tools) from a bundle server, and serves it next to your apps, so the server's capabilities change without a redeploy. A Worker has no timers between requests, so the bundle is refreshed by a Cron Trigger, which calls the returned `scheduled()` handler:

```ts
// src/worker.ts
import { env } from 'cloudflare:workers';

import { createEdgeMcp, kvBundleCacheFromEnv } from '@frontmcp/edge';

export default createEdgeMcp({
  info: { name: 'billing', version: '1.0.0' },
  apps: [],
  managed: {
    endpoint: 'https://bundles.example.com/v1/bundles/billing',
    authToken: env.BUNDLE_PULL_TOKEN,
    expectedAudience: 'billing-prod',
    jwksUrl: 'https://bundles.example.com/.well-known/jwks.json',
    expectedIssuer: 'https://bundles.example.com',
    cache: kvBundleCacheFromEnv('BUNDLE_CACHE'),
  },
});
```

```toml
# wrangler.toml
[[kv_namespaces]]
binding = "BUNDLE_CACHE"
id = "<your KV namespace id>"

[triggers]
crons = ["*/5 * * * *"]
```

`BUNDLE_PULL_TOKEN` is a secret (`npx wrangler secret put BUNDLE_PULL_TOKEN`). The configuration is evaluated when the module loads, so read the secret from the `env` that `cloudflare:workers` exports, not from a request.

| Field                                                               | Description                                                                                    |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `endpoint`                                                          | HTTPS URL that serves the signed bundle                                                        |
| `authToken`                                                         | The token the bundle server issued for this server                                             |
| `expectedAudience`, `jwksUrl`, `expectedIssuer`                     | How the bundle server's tokens are verified                                                    |
| `cache`                                                             | Keeps the last bundle applied: `kvBundleCacheFromEnv('BINDING')`, or a store of your own       |
| `enableWebhook`                                                     | Also take bundles pushed to `POST /__skilled_openapi/push`, as below                           |
| `requirePushBodyDigest`                                             | Refuse a push token without a `body_sha256` claim, as below. Default `false`                   |
| `pushReplay`                                                        | Where pushed tokens' `jti`s are kept: `{ binding }` (default `FRONTMCP_PUSH_REPLAY`), as below |
| `allowRollback`                                                     | Apply a pulled or pushed bundle older than the one being served, as below. Default `false`     |
| `requireSignature`, `trustedKeys`, `dev`, `credentials`, `outbound` | Passed to the Skilled OpenAPI plugin. `dev` skips signature checks: never use it in production |
| `confirm`                                                           | Actions that ask the user before their request, as the plugin's `confirm`; see below           |
| `pollIntervalMs`, `bundleCacheDir`                                  | Ignored on a Worker, which has no timers or file system                                        |

A Cron run ends once the bundle it pulled is applied and kept in `cache`, also when it is the first event an isolate gets: it then starts the bundle sync, whose first pull is the run's pull. A bundle that fails its signature or its other checks is not applied and not kept, so a cold start that can't reach the bundle server serves the last bundle the Worker applied.

Bundles only move forward: a pulled or pushed bundle older than the one the isolate serves is not applied and not kept, so a validly signed old bundle can't roll the Worker back. Two semver versions compare by semver; the same version (re-signed), or versions that aren't both semver, compare by `generatedAt`. To roll back, publish the earlier content under a newer version, or set `allowRollback: true`. An isolate that starts has no bundle served yet, so the cached bundle stands in for it: the isolate serves the cached bundle when its pull fails, when the pulled bundle is refused, or when it is older than the cached one (without `allowRollback`), so a stale CDN or a rolled-back origin can't take a new isolate back. Serving the cached bundle never writes it back to `cache`. Up to 1.11.0 a new isolate served whatever it pulled, served nothing when that bundle was refused, and rewrote the cache entry on an offline start.

A Cron run fails (`scheduled()` throws, so Cloudflare logs the run as an exception and counts it as a failed invocation) when its sync leaves an older bundle serving:

- **The bundle it pulled was not applied**: its signature or its other checks failed, or it is older than the one served. The error names it: `[frontmcp/edge] Cron refresh: bundle billing@4.2.0 was not applied: digest mismatch (...)`. When the run started the isolate, which then serves the cached bundle, it says `was not applied, so the cached bundle serves: older than the cached bundle billing@4.3.0 (...)`.
- **The pull failed**: `[frontmcp/edge] Cron refresh: the bundle pull failed: pull responded 503`. When the run started the isolate, which then serves the cached bundle, it says `the bundle pull failed, so the cached bundle serves`. A pull that failed on its token names the check: `the bundle pull failed (token check: expired): ...`, as `lastSync.tokenFailure` does in `/readyz`.

Up to 1.11.0, such a run reported success. A run whose pull applies a bundle, or pulls the one served, succeeds.

`/readyz` says the same, once `health: { readyz: { enabled: true } }` turns it on (it is off on a Worker by default). While the last sync was refused or failed, its `skilled-openapi` check is `degraded`, with `details: { state: 'stale', bundleId, bundleVersion, lastSync }`: the bundle served, and the refusal or failure with its reason and time. The Worker stays ready, since it serves the last good bundle. Each isolate answers for its own bundle and syncs. The details appear outside production, or with `health.includeDetails: true`.

Each operation call checks the API's host first: on a Worker, `node:dns` resolves it over DNS over HTTPS, so the host must resolve publicly.

`confirm` names the actions that ask the user before their request, by HTTP method, tag or operationId, as the Skilled OpenAPI plugin's [`confirm` option](https://frontmcp.dev/reference/plugins/skilled-openapi) does: `confirm: { methods: ['DELETE'] }`. The plugin checks it, so an invalid value refuses to start (`500 CONFIG_INVALID`, and the log names the field). The question is an MCP elicitation, which the server asks only with `elicitation: { enabled: true }`. On a Cloudflare Worker that setting refuses to start (`Elicitation requires distributed storage when running on Edge runtime`), so there an action `confirm` names is refused, `the user's confirmation is needed for voidInvoice, and this server can't ask for it: elicitation is disabled; nothing was sent`, or with `whenUnsupported: 'allow'` runs without asking. `load_skill` marks it with `asksForConfirmation: true`, and the audit log records what the confirmation came to. Up to 1.11.0 managed mode had no `confirm`, so every action ran without asking.

### Pushed bundles

With `enableWebhook: true`, the bundle server can push a new bundle instead of waiting for the next Cron run:

```http
POST /__skilled_openapi/push
Authorization: Bearer <JWT>
Content-Type: application/json

{ "schemaVersion": 1, "bundleId": "billing", "version": "4.2.0", ..., "integrity": { ... } }
```

- **The token** is checked as `authToken` is (signed by a key at `jwksUrl`, `iss` equal to `expectedIssuer`, `aud` including `expectedAudience`, not expired). It must also carry a `jti` of 8 or more characters that no push used, and an `iat` within five minutes, so the pull token, issued long before, can't push.
- **The token's `body_sha256` claim** binds it to the body: the base64url SHA-256, without padding, of the exact bytes of the request body (not the bundle's `integrity.digest`). The Worker hashes the bytes it received; any other body answers `401`, and the log says `push refused (body_mismatch)`. The refused token's `jti` stays unused, so the push it was issued for still applies. Without the claim, a token captured within its five minutes could carry any other bundle the bundle server signed for this Worker. A token without it is accepted, with one warning per isolate, so a bundle server that doesn't set it yet keeps working; `requirePushBodyDigest: true` refuses it. `pushBodyDigest(body)` and `PUSH_BODY_DIGEST_CLAIM` from `@frontmcp/adapters/skills` compute the claim for a sender.
- **The body** is the bundle as JSON, checked as a pulled bundle is: its schema, then its signature against `trustedKeys` (unless `requireSignature: false`).
- **It is applied**, unless it is older than the bundle being served, after the first pull and after any bundle already queued, so a push and a Cron run never apply at once, and then kept in `cache`.

| Status | Body                                                                                                      |
| ------ | --------------------------------------------------------------------------------------------------------- |
| `200`  | `{ "applied": true, "bundleId", "bundleVersion" }`                                                        |
| `400`  | `{ "error": "invalid_bundle" }`: the body is not a bundle                                                 |
| `401`  | `{ "error": "invalid_token" }`, with `WWW-Authenticate: Bearer error="invalid_token"`                     |
| `409`  | `{ "error": "push_replayed" }`: a push already used this token                                            |
| `409`  | `{ "error": "bundle_outdated" }`: the bundle is older than the one being served, which stays              |
| `422`  | `{ "error": "bundle_not_applied" }`: the signature or the bundle's checks failed; the served bundle stays |
| `503`  | `{ "error": "temporarily_unavailable" }`: the JWKS could not be read, or the `jti` could not be recorded  |

A refused token answers the same `401` whatever check refused it. Only the log names it: `[saas-source] push refused (wrong_issuer): ...`, or `bundle push not checked (jwks_unavailable): ...` for a `503`.

The endpoint is a hookable flow, `skilled-openapi:bundle-push`, behind the same IP filter and rate limit as the server's other HTTP flows.

The `jti`s are kept in a Durable Object that every isolate and replica of the Worker reaches, so a push replayed to another isolate is refused too. (KV can't do this: it is eventually consistent, so two isolates could both read a `jti` as unused.) Export the class and bind it:

```ts
// src/worker.ts
const mcp = createEdgeMcp({
  // ...
  managed: { /* ... */ enableWebhook: true }, // the binding defaults to FRONTMCP_PUSH_REPLAY; set pushReplay: { binding } to change it
});

export default mcp;
export const FrontMcpPushReplay = mcp.PushReplayDurableObject;
```

```toml
# wrangler.toml
[[durable_objects.bindings]]
name = "FRONTMCP_PUSH_REPLAY"
class_name = "FrontMcpPushReplay"

[[migrations]]
tag = "v1" # or the next tag, when wrangler.toml already has migrations
new_sqlite_classes = ["FrontMcpPushReplay"]
```

- **One object per audience** keeps the `jti`s, named after `expectedAudience`. Each `jti` is kept until its token's `iat` is five minutes old, and dropped after that.
- **Without the binding**, every push answers `503 temporarily_unavailable`, and the log names the missing binding. Pulls and Cron runs are not affected. Up to 1.11.0, the `jti`s were kept in each isolate's memory, which isolates don't share.
- **On Deno or Bun**, set `pushReplay` to a function of `env` that returns a store, `{ claim(key, ttlMs) }`: it resolves `true` when it recorded `key`, `false` when `key` is already recorded, and throws when it can't tell. A push is refused when it throws.

## API

### `createEdgeMcp(config)`

`config` is what `@FrontMcp` takes (`info`, `apps`, `tools`, `http`, `auth`, ...), plus:

| Field        | Type                                                | Description                                                                                                                                 |
| ------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessions`   | `{ binding? }`                                      | Keep each session in a Durable Object, bound under `binding` (default `FRONTMCP_SESSIONS`)                                                  |
| `managed`    | `ManagedEdgeOptions`                                | Pull a Skilled OpenAPI bundle, as above                                                                                                     |
| `skillIndex` | `{ binding?, ttlSeconds? }`, or a function of `env` | Keep the skills' search index in a KV namespace (default binding `FRONTMCP_SKILL_INDEX`), so a cold start reads it instead of rebuilding it |

The server never listens: `createEdgeMcp()` sets `serve: false`. Configuration faults that can be found without building the server, such as `approval` or `featureFlag` metadata no plugin enforces, throw when the module is evaluated, so the Worker fails to deploy.

It returns:

| Member                          | Description                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `fetch(request, env?, ctx?)`    | The Worker's request handler                                                                           |
| `SessionDurableObject`          | The Durable Object class for `sessions`. Export it only when you use it                                |
| `PushReplayDurableObject`       | The Durable Object class for `managed.enableWebhook`, as above                                         |
| `scheduled(event?, env?, ctx?)` | With `managed` only: the Cron Trigger handler, which pulls the bundle and throws when it isn't applied |

Other exports: `kvBundleCacheFromEnv`, `createKvBundleCache`, `kvSkillIndexCacheFromEnv`, `createKvSkillIndexCache`, `buildManagedOpenApiPluginOptions`, and the `EdgeMcp`, `EdgeMcpConfig`, `ManagedEdgeOptions`, `EdgePushReplayStore` and `EdgePushReplayStoreFactory` types.

## Docs

- [`@frontmcp/edge` reference](https://frontmcp.dev/reference/deployment/edge): `createEdgeMcp()` in full, sessions, managed mode, and how it compares with the cloudflare build target
- [Cloudflare Workers](https://frontmcp.dev/reference/deployment/cloudflare-workers): the `frontmcp build --target cloudflare` alternative, and bindings in tools
- [Skilled OpenAPI plugin](https://frontmcp.dev/reference/plugins/skilled-openapi): the bundles managed mode serves

## Related packages

- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk): the framework; `createEdgeMcp()` takes its configuration
- [`@frontmcp/plugin-skilled-openapi`](https://www.npmjs.com/package/@frontmcp/plugin-skilled-openapi): pulls and verifies the bundles in managed mode
- [`frontmcp`](https://www.npmjs.com/package/frontmcp): the CLI, whose `build --target cloudflare` is the other way to run on Workers

## Contributing

Source: [`libs/edge`](https://github.com/agentfront/frontmcp/tree/main/libs/edge). Issues and pull requests are welcome; see [CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
