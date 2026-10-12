# @frontmcp/plugin-skilled-openapi

Serves a REST API to the model as a few named **skills** instead of one tool per endpoint. You describe the API in a
**bundle**: its services, credentials, operations, and skills that each group some operations with instructions. The
model sees three tools: `search_skill` finds a skill, `load_skill` reads its instructions and the operations it offers,
and `run_workflow` runs a short script that calls those operations, each one checked, authorized and sent with
credentials the model never sees. Use it for an API with too many operations to list as tools. For a small API, where
the model should see every operation, use the OpenAPI adapter in
[`@frontmcp/adapters`](https://www.npmjs.com/package/@frontmcp/adapters); the two work side by side.

[![npm](https://img.shields.io/npm/v/@frontmcp/plugin-skilled-openapi.svg)](https://www.npmjs.com/package/@frontmcp/plugin-skilled-openapi) [![License](https://img.shields.io/npm/l/@frontmcp/plugin-skilled-openapi.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

```bash
npm install @frontmcp/plugin-skilled-openapi @enclave-vm/core @enclave-vm/ast
```

The plugin runs inside a FrontMCP server, so your app needs `@frontmcp/sdk`, at the same version as this package, and
Node.js 24 or later. Its peer dependency `@frontmcp/lazy-zod` comes with the SDK. The other peers are optional:

| Package                               | Enables                                                                                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@enclave-vm/core`, `@enclave-vm/ast` | `run_workflow`. Without them, `search_skill` and `load_skill` still work, and `run_workflow` answers `workflow execution unavailable: the @enclave-vm sandbox is not installed`. |
| `undici`                              | `outbound.egressProxy` on Node.js. The plugin loads it only when that option is set.                                                                                             |

## Usage

Register the plugin with `SkilledOpenApiPlugin.init()` (also the package's default export) in the `plugins` of
`@FrontMcp` or of an `@App`, and point it at a bundle:

```ts
import { SkilledOpenApiPlugin } from '@frontmcp/plugin-skilled-openapi';
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'billing', version: '1.0.0' },
  apps: [],
  plugins: [
    SkilledOpenApiPlugin.init({
      source: { type: 'static', path: './billing.bundle.json', watch: true },
      requireSignature: false,
      credentials: { 'billing-token': process.env.BILLING_API_TOKEN! },
    }),
  ],
})
export default class Server {}
```

`requireSignature: false` lets an unsigned bundle load while you develop. In production, sign the bundle in CI, list the
public key in `trustedKeys`, and set `unprotectedOps: 'deny'`; see [Security](#security).

`tools/list` then returns `search_skill`, `load_skill` and `run_workflow`, and none of the bundle's operations. After
loading a skill, the model runs its operations with a script:

```jsonc
// run_workflow arguments
{ "script": "const invoice = await callTool('getInvoice', { id: 'INV-1' }); return invoice.status;" }
// result
{ "success": true, "value": "paid", "stats": { "durationMs": 12, "toolCalls": 1, "steps": 3 } }
```

## The three tools

| Tool           | Input                                                | What it does                                                                                                                                                                             |
| -------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_skill` | `query`, `limit?` (default 20), `tags?`, `notQuery?` | Searches the skills and returns `{ skills: [{ skillId, name, description, score }] }`. Its description lists the skills the caller may use, so the model sees what the server can do.    |
| `load_skill`   | `skillId`                                            | Returns the skill's markdown instructions and its `actions`, with their input and output JSON Schemas: the `actionId`s a script calls.                                                   |
| `run_workflow` | `script`                                             | Runs an AgentScript program (a subset of JavaScript) in the `@enclave-vm` sandbox. Each `await callTool(actionId, input)` calls an operation; the script's `return` value is the result. |

For each `callTool`, the plugin checks the caller against the operation's and skill's `requiredAuthorities`, validates
the input against the operation's `inputSchema`, sends the request with the credential from the bundle's auth binding,
and checks a JSON answer against `outputSchema`. The first failure ends the script with `success: false`. A script may
make up to 25 calls and run for up to 8 seconds.

With `exposeOperationsAsInternalTools` (the default), each operation is also an internal tool named
`<bundleId>.<operationId>`, which your own tools can call with `this.callTool()`. Clients can't list or call it.

## Options

`init()` checks the options with a Zod schema, exported as `skilledOpenApiPluginOptionsSchema`, and throws a `ZodError`
for a bad one.

| Option                            | Type                                                     | Default                             | Description                                                                                                                                              |
| --------------------------------- | -------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`                          | `{ type: 'inline' \| 'static' \| 'npm' \| 'saas', ... }` | required                            | Where the bundle comes from. See [Sources](#sources).                                                                                                    |
| `requireSignature`                | `boolean`                                                | `true`, or `false` with `dev: true` | Apply only bundles signed by one of `trustedKeys`. An explicit value wins over `dev`.                                                                    |
| `trustedKeys`                     | `{ keyId, alg: 'RS256' \| 'EdDSA', publicKeyPem }[]`     | `[]`                                | Public keys a bundle may be signed with, matched by `keyId`.                                                                                             |
| `credentials`                     | `Record<string, string>`                                 |                                     | Secrets for the bundle's auth bindings, keyed by `vaultRef`. To read them from a vault instead, replace the `SkilledOpenApiCredentialResolver` provider. |
| `unprotectedOps`                  | `'allow' \| 'deny'`                                      | `'allow'`                           | Whether an operation with no `requiredAuthorities`, on itself or its skill, may be called. `'deny'` blocks it unless it's marked `public: true`.         |
| `outbound`                        | `OutboundOptions`                                        | see below                           | Limits on the requests to your API.                                                                                                                      |
| `dev`                             | `boolean`                                                | `false`                             | For development only: turns off signature checks (unless `requireSignature` is set) and allows `http:` URLs. Logs a warning.                             |
| `bundleCacheDir`                  | `string`                                                 | `'.frontmcp/skilled-openapi/'`      | Where the `saas` source keeps the last bundle it pulled, used when a pull fails at startup.                                                              |
| `exposeOperationsAsInternalTools` | `boolean`                                                | `true`                              | Register each operation as an internal tool for `this.callTool()`.                                                                                       |
| `sourceConflictPolicy`            | `'static-wins' \| 'last-wins' \| 'reject'`               | `'static-wins'`                     | Accepted and currently unused: the plugin has one source.                                                                                                |

`outbound`:

| Field                     | Default  | Description                                                                                                             |
| ------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `allowHttp`               | `false`  | Allow `http:` services. `dev: true` turns it on.                                                                        |
| `allowPrivateNetworks`    | `false`  | Allow services on private and loopback addresses. Link-local and cloud metadata addresses stay blocked. Logs a warning. |
| `defaultTimeoutMs`        | `30000`  | How long a request may take, in milliseconds. An operation's `timeoutMs` overrides it.                                  |
| `defaultMaxResponseBytes` | `262144` | The largest response read (256 KB). An operation's `maxResponseBytes` overrides it.                                     |
| `maxConcurrencyPerHost`   | `10`     | Requests in flight to one host; more wait their turn.                                                                   |
| `egressProxy`             |          | A proxy URL every request to your API goes through. Needs `undici` on Node.js.                                          |

### Sources

| `type`   | Fields                                                                                      | What it does                                                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `inline` | `content`                                                                                   | The bundle object itself. For tests, bundles built in code, and runtimes without a file system.                                                                                                        |
| `static` | `path`, `watch?`                                                                            | A JSON or YAML bundle file, resolved from the working directory. With `watch: true`, the plugin reloads it when it changes.                                                                            |
| `npm`    | `packageName`, `exportName?`, `verifyProvenance?`                                           | Imports a package and uses one of its exports. Provenance checks aren't implemented yet, so the default `verifyProvenance: true` refuses to load it; set `false` only for a package you pin and trust. |
| `saas`   | `endpoint`, `authToken`, `expectedAudience`, `jwksUrl`, `expectedIssuer`, `pollIntervalMs?` | Pulls the bundle over HTTPS at startup and every `pollIntervalMs` (default 5 minutes), after checking `authToken` against `jwksUrl`, `expectedIssuer` and `expectedAudience`.                          |

A new bundle from `static` (with `watch`) or `saas` is checked like the first, then replaces the skills and operations
at once. A bundle that fails its checks isn't applied, and the reason is logged.

### The bundle

A bundle is a JSON or YAML object with `schemaVersion`, `bundleId`, `version`, `services`, `authBindings`, `skills`,
`operations` and, when signed, `integrity`. It can also be wrapped in an OpenAPI Overlay document, under
`info["x-frontmcp-bundle"]`, so it can live next to the spec it describes. `compileSkilledBundleFromOpenApi()` from
`@frontmcp/adapters/skills` builds the services and operations from an OpenAPI spec, and the same entry point exports
`canonicalize()`, `bundleDigest()` and `verifyBundleSignature()` for signing in CI. See
[The bundle](https://frontmcp.dev/reference/plugins/skilled-openapi#the-bundle) for every field.

## Security

- **Signing.** With `requireSignature` (the default), a bundle is applied only if its `integrity` signature, RS256 or
  EdDSA (Ed25519) over the bundle's canonical JSON, verifies with a key in `trustedKeys`. A signed bundle is still
  checked for shape: unknown fields are errors, and path templates and header names are restricted.
- **Authorization.** `requiredAuthorities` on skills and operations are checked on every `callTool`. Skills organize
  what the model reads; they don't limit what a script can call, so protect operations with rules and use
  `unprotectedOps: 'deny'` in production. Each caller is shown only the skills and actions their rules allow.
- **Credentials.** Credentials stay on the server: the plugin adds them to each request, and the script gets only the
  API's answer. Redirects aren't followed, so a credential isn't sent elsewhere.
- **Outbound requests.** URLs must be `https:` (unless `allowHttp`) and on the operation's service host. The host's
  addresses are checked before sending: private and loopback addresses are refused unless `allowPrivateNetworks`, and
  link-local and cloud metadata addresses always. Responses are size- and time-limited.
- **What reaches the model.** The model sees only what the script returns, but the content of your API's answers isn't
  checked. Treat text your API returns, like ticket bodies or notes, as you would user input.

See [What the checks protect against](https://frontmcp.dev/reference/plugins/skilled-openapi#what-the-checks-protect-against)
for the full model.

## Docs

- [Skilled OpenAPI reference](https://frontmcp.dev/reference/plugins/skilled-openapi): options, sources, the bundle
  format, credentials, authorization, signing and the audit log.
- [Serving a bundle](https://frontmcp.dev/reference/plugins/skilled-openapi#serving-a-bundle): a runnable example.
- [Building a bundle from an OpenAPI spec](https://frontmcp.dev/reference/plugins/skilled-openapi#building-a-bundle-from-an-openapi-spec).
- [Teaching the model skills](https://frontmcp.dev/learn/teaching-the-model-skills): skills in FrontMCP.

## Related packages

- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk): the FrontMCP framework this plugin runs in.
- [`@frontmcp/adapters`](https://www.npmjs.com/package/@frontmcp/adapters): the OpenAPI adapter, one tool per
  operation, and the `@frontmcp/adapters/skills` bundle tools.
- [`@frontmcp/plugin-codecall`](https://www.npmjs.com/package/@frontmcp/plugin-codecall): lets the model write scripts
  that call your server's own tools.

## Contributing

Source:
[`plugins/plugin-skilled-openapi`](https://github.com/agentfront/frontmcp/tree/main/plugins/plugin-skilled-openapi).
Issues and pull requests are welcome; see
[CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
