# @frontmcp/edge

Run a FrontMCP server on Cloudflare Workers from a plain configuration object. The Worker's entry file calls `createEdgeMcp()` with the configuration you'd give `@FrontMcp` and exports what it returns; `wrangler` bundles that file as it is, with no `frontmcp build` step and no `@FrontMcp` class. Compared with `frontmcp build --target cloudflare`, it adds sessions kept in a Durable Object and a managed mode that pulls a Skilled OpenAPI bundle and refreshes it from a Cron Trigger.

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
- **It serves** MCP at `http.entryPath` (`/` by default) and `/healthz`.
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
| `cache`                                                             | Where the last good bundle is kept: `kvBundleCacheFromEnv('BINDING')`, or a store of your own  |
| `enableWebhook`                                                     | Also accept pushed updates at `POST /__skilled_openapi/push`                                   |
| `requireSignature`, `trustedKeys`, `dev`, `credentials`, `outbound` | Passed to the Skilled OpenAPI plugin. `dev` skips signature checks: never use it in production |
| `pollIntervalMs`, `bundleCacheDir`                                  | Ignored on a Worker, which has no timers or file system                                        |

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

| Member                          | Description                                                             |
| ------------------------------- | ----------------------------------------------------------------------- |
| `fetch(request, env?, ctx?)`    | The Worker's request handler                                            |
| `SessionDurableObject`          | The Durable Object class for `sessions`. Export it only when you use it |
| `scheduled(event?, env?, ctx?)` | With `managed` only: the Cron Trigger handler, which pulls the bundle   |

Other exports: `kvBundleCacheFromEnv`, `createKvBundleCache`, `kvSkillIndexCacheFromEnv`, `createKvSkillIndexCache`, `buildManagedOpenApiPluginOptions`, and the `EdgeMcp`, `EdgeMcpConfig` and `ManagedEdgeOptions` types.

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
