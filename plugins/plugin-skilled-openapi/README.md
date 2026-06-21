# @frontmcp/plugin-skilled-openapi

> Wrap your REST API as a **skilled MCP server** without rewriting any controllers.

This plugin lets a FrontMCP server consume **skill bundles** (a standard OpenAPI spec plus an Overlay, optionally signed) and serve them as MCP **skills**. The MCP client only ever sees three meta-tools — `search_skill`, `load_skill`, `run_workflow` — while the per-operation REST tools stay hidden behind the skill abstraction. `run_workflow` runs a short AgentScript program in a dependency-free enclave sandbox where each `await callTool(actionId, input)` invokes a loaded skill's operation, so one workflow can chain many calls in a single round-trip.

This sidesteps the well-documented "tool overload" problem (model reliability degrades past ~20 tools, GPT Actions caps at 30, Cursor at 40) when wrapping a real-world API with hundreds of endpoints.

## Installation

```bash
npm install @frontmcp/plugin-skilled-openapi
```

The `run_workflow` meta-tool runs AgentScript in the [`@enclave-vm`](https://www.npmjs.com/package/@enclave-vm/core) sandbox, which is an **optional** peer dependency. Install it to enable workflows (without it, `search_skill`/`load_skill` still work and `run_workflow` returns a clear "sandbox not installed" error):

```bash
npm install @enclave-vm/core @enclave-vm/ast
```

## Usage

Register the plugin with `SkilledOpenApiPlugin.init(...)` and point it at a bundle source. The `dev: true` flag bypasses signature verification and allows `http://` upstreams for local iteration — see [Security](https://docs.agentfront.dev/frontmcp/plugins/skilled-openapi/security) before going to production.

```typescript
import * as path from 'node:path';
import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import SkilledOpenApiPlugin from '@frontmcp/plugin-skilled-openapi';

@FrontMcp({
  info: { name: 'Skilled-OpenAPI Demo', version: '0.1.0' },
  apps: [],
  plugins: [
    SkilledOpenApiPlugin.init({
      source: { type: 'static', path: path.resolve(__dirname, '../bundle.json'), watch: true },
      // Local iteration only — bypasses signing and allows http:// upstreams.
      dev: true,
      requireSignature: false,
      // Dev/single-tenant credential map (vaultRef -> secret). In production,
      // resolve credentials from @frontmcp/auth's vault instead.
      credentials: { 'billing-token': 'demo-bearer-xyz' },
    }),
  ],
  http: { port: 3010 },
  logging: { level: LogLevel.Info },
})
export default class Server {}
```

With the server running, `tools/list` returns **only** `search_skill`, `load_skill`, `run_workflow`; the bundle's operations are hidden. A workflow then drives them:

```jsonc
// run_workflow
{ "script": "const inv = await callTool('createInvoice', { customerId: 'cus_1', amount: 4200 }); return inv;" }
// -> { "success": true, "value": { "id": "inv_1", "status": "open" }, "stats": { "durationMs": 12, "toolCalls": 1, "steps": 3 } }
```

See the [5-minute quickstart](https://docs.agentfront.dev/frontmcp/plugins/skilled-openapi/quickstart) for an end-to-end run against a mock upstream.

## How it works

```text
OpenAPI spec  --(analyzer + optional signing)-->  bundle (spec + overlay)
                                                  │
                                                  ▼
                          FrontMCP server with @frontmcp/plugin-skilled-openapi
                                                  │
                                                  ▼
   tools/list    ->  [ search_skill, load_skill, run_workflow ]
   skills/*      ->  curated skills (each carrying instructions + actions[])
   run_workflow  ->  enclave sandbox runs AgentScript; per callTool(actionId, input):
                     authorize (ABAC) -> validate input -> HTTPS -> validate output -> result
```

## Meta-Tools

| Tool | Purpose |
| --- | --- |
| `search_skill` | Semantic search over the loaded skills; returns matching `skillId`s with scores. The live skill catalog is injected into the tool description so the model can discover what's available. |
| `load_skill` | Returns a skill's markdown instructions plus its `actions[]` and their JSON Schemas (the `actionId`s a workflow calls). |
| `run_workflow` | Runs an AgentScript `script` in the enclave sandbox. Each `await callTool(actionId, input)` invokes a loaded operation through the full authorize → validate → HTTPS → validate path; the script's `return` value is surfaced as the result. |

## Features

- **Three meta-tools instead of hundreds of endpoints** — keeps the client's tool list small and reliable.
- **Composable workflows** — one `run_workflow` call can chain multiple operations in a sandboxed AgentScript program.
- **Multiple bundle sources** — `static` (file), `npm` (pinned package), `saas` (CI-driven, signed, hot-pulled), or `inline`.
- **Hot reload** — `static`/`saas` sources watch for changes and emit `notifications/skills/list_changed` on an atomic swap.
- **Hidden operation tools** — per-operation REST tools never reach `tools/list`; they're reachable only via `callTool` inside a workflow.
- **Defense-in-depth security** — see below.

## Configuration

All options are validated by a strict Zod schema (`skilledOpenApiPluginOptionsSchema`).

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `source` | `static \| npm \| saas \| inline` | — (required) | Where bundles come from. `{ type: 'static', path, watch? }`, `{ type: 'npm', package }`, `{ type: 'saas', endpoint, ... }`, or `{ type: 'inline', ... }`. |
| `requireSignature` | `boolean` | `true` | Require a valid bundle signature (RS256/Ed25519 JWT-of-hashes). Opt out only with `dev: true`. |
| `trustedKeys` | `SignatureKey[]` | `[]` | Public keys trusted to sign bundles. |
| `dev` | `boolean` | `false` | Local-dev escape hatch: bypasses signing and widens `outbound` to allow `http://`. **Never enable in production.** |
| `outbound` | `OutboundOptions` | see below | SSRF / egress controls. |
| `unprotectedOps` | `'allow' \| 'deny'` | `'allow'` | Default-deny policy for operations that declare no required authorities. |
| `sourceConflictPolicy` | `'static-wins' \| 'last-wins' \| 'reject'` | `'static-wins'` | How to resolve two sources registering the same skill id. |
| `bundleCacheDir` | `string` | — | Last-good cache directory (only for `source.type === 'saas'`). |
| `credentials` | `Record<vaultRef, secret>` | — | In-memory credential map for dev / single-tenant. In production resolve via `@frontmcp/auth`'s vault. |
| `exposeOperationsAsInternalTools` | `boolean` | `true` | Keep operations reachable via `callTool` inside workflows. |

`outbound` (SSRF + egress):

| Field | Default | Description |
| --- | --- | --- |
| `allowPrivateNetworks` | `false` | Allow connections to private/loopback/link-local IPs. |
| `allowHttp` | `false` | Allow `http://` upstreams (auto-enabled by `dev: true`). |
| `egressProxy` | — | Optional egress proxy URL. |
| `maxConcurrencyPerHost` | `10` | Per-host concurrency cap. |
| `defaultTimeoutMs` | `30000` | Per-request timeout. |
| `defaultMaxResponseBytes` | `262144` | Per-response size cap. |

Full reference: [Configuration](https://docs.agentfront.dev/frontmcp/plugins/skilled-openapi/configuration).

## Security model

- **Optional bundle signing** (RS256/Ed25519 JWT-of-hashes). `requireSignature: true` is the default; opt out only via explicit `dev: true`.
- **RFC 8707 Resource Indicators** enforced on every inbound JWT (per the MCP authorization spec), blocking confused-deputy attacks at admission.
- **Layered SSRF defenses** — URL string check → host allowlist (the operation's single declared service) → post-DNS-resolution IP blocklist (RFC 1918, link-local incl. cloud metadata, loopback, ULA) → DNS-rebinding pin → per-host concurrency cap → optional egress proxy.
- **Bundle data treated as adversarial** even after signature verification — WHATWG `URL` only, RFC 7230 header validation, no shell-out, no `eval`, strict JSON Schema with `additionalProperties: false`.
- **Indirect-prompt-injection mitigations** — `run_workflow` runs in a no-host-access sandbox (upstream data reaches the model only via the script's `return`), output-schema validation is mandatory on each action, and responses are size-capped.

Details: [Security](https://docs.agentfront.dev/frontmcp/plugins/skilled-openapi/security).

## Standards alignment

- **OpenAPI Overlay 1.0/1.1** — a bundle is a standard OpenAPI spec plus an Overlay layering `x-frontmcp-skill: <id>` annotations onto operations, so customers can hand-author overlays in any OpenAPI tool.
- **SEP-2076** (Agent Skills as a First-Class MCP Primitive, working-group draft) — skills surface via the SDK's skills primitive when the client supports it, falling back to meta-tool-only mode otherwise.
- **Anthropic Agent Skills format** — skill content is markdown with progressive disclosure.

## Documentation

Full docs: **https://docs.agentfront.dev/frontmcp/plugins/skilled-openapi**

- [Overview](https://docs.agentfront.dev/frontmcp/plugins/skilled-openapi/overview) · [Quickstart](https://docs.agentfront.dev/frontmcp/plugins/skilled-openapi/quickstart) · [Sources](https://docs.agentfront.dev/frontmcp/plugins/skilled-openapi/sources) · [Bundle format](https://docs.agentfront.dev/frontmcp/plugins/skilled-openapi/bundle-format)
- [Configuration](https://docs.agentfront.dev/frontmcp/plugins/skilled-openapi/configuration) · [Meta-tools](https://docs.agentfront.dev/frontmcp/plugins/skilled-openapi/meta-tools) · [Security](https://docs.agentfront.dev/frontmcp/plugins/skilled-openapi/security) · [API reference](https://docs.agentfront.dev/frontmcp/plugins/skilled-openapi/api-reference)

## License

Apache-2.0
