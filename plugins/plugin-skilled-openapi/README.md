# @frontmcp/plugin-skilled-openapi

Serves a REST API to the model as a few named **skills** instead of one tool per endpoint. You describe the API in a
**bundle**: its services, credentials, operations, and skills that each group some operations with instructions. The
model sees four tools: `search_skill` finds a skill, `load_skill` reads its instructions and the operations it offers,
`execute_action` runs one of those operations, and `run_workflow` runs a short script that chains several. Each call is
checked, authorized and sent with credentials the model never sees. Use it for an API with too many operations to list as tools. For a small API, where
the model should see every operation, use the OpenAPI adapter in
[`@frontmcp/adapters`](https://www.npmjs.com/package/@frontmcp/adapters); the two work side by side.

[![npm](https://img.shields.io/npm/v/@frontmcp/plugin-skilled-openapi.svg)](https://www.npmjs.com/package/@frontmcp/plugin-skilled-openapi) [![License](https://img.shields.io/npm/l/@frontmcp/plugin-skilled-openapi.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

```bash
npm install @frontmcp/plugin-skilled-openapi @enclave-vm/core @enclave-vm/ast
```

The plugin runs inside a FrontMCP server, so your app needs `@frontmcp/sdk`, at the same version as this package, and
Node.js 24 or later. Its peer dependency `@frontmcp/lazy-zod` comes with the SDK. The other peers are optional:

| Package                               | Enables                                                                                                                                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@enclave-vm/core`, `@enclave-vm/ast` | `run_workflow`. Without them, `search_skill`, `load_skill` and `execute_action` still work, and `run_workflow` answers `workflow execution unavailable: the @enclave-vm sandbox is not installed`. |
| `undici`                              | `outbound.egressProxy` on Node.js. The plugin loads it only when that option is set.                                                                                                               |

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
public key in `trustedKeys`, and set `unprotectedOps: 'deny'`; see [Security](#security). For the credentials, see
[Credentials](#credentials).

A server runs one Skilled OpenAPI plugin. One bundle can describe several services, each with its own base URL and auth
binding, so put them in one bundle. A second instance, in the same `plugins` list or in another one (the server's and an
app's, or two apps'), makes the server fail at startup with a `DuplicatePluginError` that says so. To serve separate
bundles, give each its own app with `splitByApp: true`: each app is then a server of its own. Up to 1.11.0 a second
instance started without an error, and only one of the bundles was served.

`tools/list` then returns `search_skill`, `load_skill`, `execute_action` and `run_workflow`, and none of the bundle's
operations. After loading a skill, the model runs one of its operations with `execute_action`, or several with a
script:

```jsonc
// execute_action arguments
{ "actionId": "getInvoice", "input": { "id": "INV-1" } }
// result: the operation's data, as structuredContent
{ "id": "INV-1", "status": "paid" }

// run_workflow arguments
{ "script": "const invoice = await callTool('getInvoice', { id: 'INV-1' }); return invoice.status;" }
// result
{ "success": true, "value": "paid", "stats": { "durationMs": 12, "toolCalls": 1, "steps": 3 } }
```

## The four tools

| Tool             | Input                                                | What it does                                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_skill`   | `query`, `limit?` (default 20), `tags?`, `notQuery?` | Searches the skills and returns `{ skills: [{ skillId, name, description, score, bundleVersion }] }`, where `bundleVersion` is the version of the bundle the skill comes from. Its description lists the skills the caller may use, so the model sees what the server can do, and loads a skill it names with `load_skill` directly, without searching.           |
| `load_skill`     | `skillId`, or `skillIds` (up to 10)                  | Returns the skill's markdown instructions and its `actions`, with their input and output JSON Schemas: the `actionId`s a script calls. `skillId` takes the name the catalog shows, or an id; `skillIds` loads several, under `skills`. Its description tells the model to load each skill once per conversation, and again only when its `bundleVersion` changes. |
| `execute_action` | `actionId`, `input?`                                 | Runs one action, with no script and no sandbox, and answers with its data. A failure is an error result (`isError: true`) whose text says why, and whose structured content is `{ ok: false, status, data?, error? }`.                                                                                                                                            |
| `run_workflow`   | `script`                                             | Runs an AgentScript program (a subset of JavaScript) in the `@enclave-vm` sandbox. Each `await callTool(actionId, input)` calls an operation, and `callTool(actionId, input, { throwOnError: false })` returns `{ ok, status, data }` instead of throwing; the script's `return` value is the result.                                                             |

For each `callTool`, and for each `execute_action` call, the plugin checks the caller against the operation's and
skill's `requiredAuthorities`, validates the input against the operation's `inputSchema`, sends the request with the
credential from the bundle's auth binding, checks a JSON answer against `outputSchema`, and writes the audit records.
A failed call throws, which ends the script with `success: false`. A script may make up to 25 calls and run for up to
8 seconds.

When your API answers with an error status, the error includes its error body, so the model can correct the call. A
JSON body is compacted, a text body is kept as it is, and a body over 2 KB is cut and ends with `…`. Credentials found
in it (a `Bearer` value, a JWT, the field the operation's credential is sent in) are replaced with `[REDACTED]`:

```text
action "refundInvoice" failed with status 422: {"error":"refund_too_large","message":"Refund 500 exceeds the paid amount 120.","maxRefund":120}
```

Set `outbound.errorBodies: 'status-only'` for an API whose error bodies hold internal details: the error then names the
status alone, as up to 1.11.0.

To branch on a failure instead, call `callTool(actionId, input, { throwOnError: false })`. It returns
`{ ok, status, data }`: on success, `ok: true` and the data; on an error status, `ok: false`, the status and the error
body as `data` (a body over 2 KB as its cut text). A failure with no answer (authorization, input validation, timeout,
abort, an unknown action) has `status: 0` and an `error` string. AgentScript has no `try`/`catch`. The call is checked
and audited the same way: a failure is still audited as one.

```js
const invoice = await callTool('getInvoice', { id: 'INV-1' }, { throwOnError: false });
if (invoice.status === 404) return { invoice: null };
return { invoice: invoice.data };
```

A workflow that fails (`success: false`) is an error result: `isError: true`, with the same `structuredContent`, so
an MCP client sees a failed tool call and the generated CLI's `run-workflow` exits 1. Up to 1.11.0 the result had no
`isError`, and the CLI exited 0.

When a script ends, whatever ends it, the plugin aborts the requests it still has in flight and sends none after, so a
request can't reach your API once the model has been told the workflow failed. A cancelled `run_workflow` call does
the same. An aborted request fails with `request aborted: <reason>`, such as `request aborted: the workflow ended before
the request finished`, and the audit log records it as a failed call. An operation's `timeoutMs` still applies within
the script's time limit.

An operation that several skills list runs when the caller satisfies the operation's rule and the rule of any one of
those skills, whatever the order of the skills in the bundle. `load_skill` judges each skill the same way, so the call
and the listing agree. A rule that depends on the action's input can't be judged until the call, though: `load_skill`
still lists such an action, and the call can be refused once its input is known.

### One action with `execute_action`

`execute_action` takes the `actionId` of an action `load_skill` listed and its `input`, and runs it without a script,
so it works without `@enclave-vm/core`. It runs the same checks as a script's `callTool`. On success its structured
content is the operation's data: a JSON object as it is, anything else under `value`; a bodyless answer, such as a 204,
has no structured content and a text that names the status. A failure is an error result, so an MCP client sees a
failed call and the generated CLI's `execute-action` exits 1:

```jsonc
// execute_action { "actionId": "refundInvoice", "input": { "id": "INV-1", "amount": 500 } }
{
  "isError": true,
  "content": [
    { "type": "text", "text": "action \"refundInvoice\" failed with status 422: {\"error\":\"refund_too_large\"}" },
  ],
  "structuredContent": { "ok": false, "status": 422, "data": { "error": "refund_too_large" } },
}
```

The text is the error a script's `callTool` throws: an authority denial, a failed input or output check, a timeout, an
unknown action, or the API's status and error body (as `outbound.errorBodies` allows). The structured content is what
`callTool(actionId, input, { throwOnError: false })` returns. Its annotations are `run_workflow`'s
(`destructiveHint: true`, `openWorldHint: true`), as it runs any action.

`execute_action` runs the action through its operation tool (below), with the caller's auth, so the `tools:call-tool`
hooks run for the operation's own call too. With `exposeOperationsAsInternalTools: false` there is no operation tool:
it runs the same checks itself, and the hooks run for the `execute_action` call only.

### Operation tools

With `exposeOperationsAsInternalTools` (the default), each operation is also an internal tool named
`<bundleId>.<operationId>`, which your own tools can call with `this.callTool()`. Clients can't list or call it. It
runs the checks a `run_workflow` call runs, authorization, the input and output schemas and the audit records, and
aborts its request when the tool call is cancelled or times out. It answers, without `isError`, with structured
content `{ ok, status, data?, contentType?, error? }`: on an HTTP failure, `data` is the API's error body, redacted and
cut to 2 KB, or left out with `outbound.errorBodies: 'status-only'`.

Up to 1.11.0 an operation tool skipped the output schema check and the audit log, so an answer that didn't match the
schema came back as `ok: true`, and its `data` on an HTTP failure was the API's whole error body, whatever
`errorBodies` said.

## Credentials

For each request, the plugin asks a credential resolver for the secret of the operation's auth binding, by its
`vaultRef`. The built-in resolver reads the `credentials` option. To read a vault instead, provide a
`SkilledOpenApiCredentialResolver` in `@FrontMcp({ providers })`, in the `@App` that installs the plugin, or in
`init({ providers })`. The nearest one replaces the built-in resolver:

```ts
import {
  SkilledOpenApiCredentialResolver,
  SkilledOpenApiPlugin,
  type CredentialResolveOptions,
} from '@frontmcp/plugin-skilled-openapi';
import { FrontMcp } from '@frontmcp/sdk';

class VaultCredentialResolver extends SkilledOpenApiCredentialResolver {
  async resolve(ref: string, { bundleId, authInfo }: CredentialResolveOptions): Promise<string | undefined> {
    return vault.read(`${bundleId}/${authInfo.user?.['tenant']}/${ref}`);
  }
}

@FrontMcp({
  info: { name: 'billing', version: '1.0.0' },
  apps: [],
  plugins: [SkilledOpenApiPlugin.init({ source: { type: 'static', path: './billing.bundle.json' } })],
  providers: [{ provide: SkilledOpenApiCredentialResolver, useValue: new VaultCredentialResolver() }],
})
export default class Server {}
```

The resolver is asked on every request, so a rotated secret is sent from the next request on, without a restart. A
request whose secret doesn't resolve fails, and isn't sent. `authInfo` is the caller the request is for (its token,
`user` claims and `sessionId`), so a resolver that serves several tenants can pick each one's credential, as above. A
resolver that caches credentials must key its cache by the caller too.

An operation tool, which `execute_action` and your own tools' `this.callTool()` run, uses the resolver the server's
providers declare. When the plugin is installed in an `@App`, declare it in `init({ providers })` or in
`@FrontMcp({ providers })` for those calls: one in `@App({ providers })` reaches `run_workflow` only.

Up to 1.11.0 a resolver declared in `@FrontMcp({ providers })` or `@App({ providers })` was ignored, and the built-in
one kept answering: only `init({ providers })` replaced it. It was told only `bundleId`, not the caller.

### Each caller's own credential

When each caller has an account of their own with the API, map the binding's `vaultRef` to the auth provider the
caller connects it as, with `authProviders`. Each request then sends the credential the caller connected, read from
the same vaults `@Tool({ authProviders })` reads: the auth providers vault (`this.authProviders`), else the session
credential vault (`this.credentials`), where `local` and `remote` modes keep what `authenticate()` returns.

```ts
SkilledOpenApiPlugin.init({
  source: { type: 'static', path: './billing.bundle.json' },
  authProviders: { 'billing-token': 'billing' },
});
```

In `local` mode a caller connects it at sign-in when `authenticate()` returns
`credentials: [{ key: 'billing', secret }]`, or later through the connect link below. The bundle stays portable: it
names only the `vaultRef`, and the server decides where its credential comes from.

- A caller who hasn't connected the provider gets `ToolCredentialsRequiredError` (JSON-RPC `-32001`), with
  `data: { tool, providers, authUrl }`, as a tool whose `authProviders` the caller hasn't connected does. `authUrl`, the
  session vault's `/oauth/connect` link, is there when the server can make one. The message names the provider but not
  the link, which lets its holder connect a credential for the caller. Nothing is sent to the API.
- A mapped `vaultRef` never falls back to `credentials`, to a resolver, or to another caller's credential.
- The error ends a `run_workflow` run even when the script passes `{ throwOnError: false }`, since the script can't
  fix it. From `this.callTool()`, the operation tool throws it, so your tool's call fails with it unless you catch it.
  `execute_action` raises it as it comes from the operation tool, whose name is its `tool` (`execute_action` with
  `exposeOperationsAsInternalTools: false`).
- The credential is read on each request and kept only for that request. An auth provider with `global` scope is
  shared by every caller: map a provider with `user` or `session` scope.
- An auth providers credential of type `oauth`, `oauth_pkce` or `bearer` sends its token, and `api_key` its key; other
  types fail the request.

## Options

`init()` checks the options with a Zod schema, exported as `skilledOpenApiPluginOptionsSchema`, and throws a `ZodError`
for a bad one.

| Option                            | Type                                                     | Default                             | Description                                                                                                                                                    |
| --------------------------------- | -------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`                          | `{ type: 'inline' \| 'static' \| 'npm' \| 'saas', ... }` | required                            | Where the bundle comes from. See [Sources](#sources).                                                                                                          |
| `requireSignature`                | `boolean`                                                | `true`, or `false` with `dev: true` | Apply only bundles signed by one of `trustedKeys`. An explicit value wins over `dev`.                                                                          |
| `trustedKeys`                     | `{ keyId, alg: 'RS256' \| 'EdDSA', publicKeyPem }[]`     | `[]`                                | Public keys a bundle may be signed with, matched by `keyId`.                                                                                                   |
| `credentials`                     | `Record<string, string>`                                 |                                     | Secrets for the bundle's auth bindings, keyed by `vaultRef`. To read them from a vault instead, declare a resolver as [Credentials](#credentials) shows.       |
| `authProviders`                   | `Record<string, string>`                                 |                                     | Bindings that send each caller's own credential: the auth provider name for each `vaultRef`. See [Each caller's own credential](#each-callers-own-credential). |
| `unprotectedOps`                  | `'allow' \| 'deny'`                                      | `'allow'`                           | Whether an operation with no `requiredAuthorities`, on itself or its skill, may be called. `'deny'` blocks it unless it's marked `public: true`.               |
| `outbound`                        | `OutboundOptions`                                        | see below                           | Limits on the requests to your API.                                                                                                                            |
| `dev`                             | `boolean`                                                | `false`                             | For development only: turns off signature checks (unless `requireSignature` is set) and allows `http:` URLs. Logs a warning.                                   |
| `bundleCacheDir`                  | `string`                                                 | `'.frontmcp/skilled-openapi/'`      | Where the `saas` source keeps the last bundle it pulled, used when a pull fails at startup.                                                                    |
| `exposeOperationsAsInternalTools` | `boolean`                                                | `true`                              | Register each operation as an internal tool for `this.callTool()`, which `execute_action` runs an action through.                                              |
| `sourceConflictPolicy`            | `'static-wins' \| 'last-wins' \| 'reject'`               | `'static-wins'`                     | Accepted and currently unused: the plugin has one source.                                                                                                      |

`outbound`:

| Field                     | Default     | Description                                                                                                                         |
| ------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `allowHttp`               | `false`     | Allow `http:` services. `dev: true` turns it on.                                                                                    |
| `allowPrivateNetworks`    | `false`     | Allow services on private and loopback addresses. Link-local and cloud metadata addresses stay blocked. Logs a warning.             |
| `defaultTimeoutMs`        | `30000`     | How long a request may take, in milliseconds. An operation's `timeoutMs` overrides it.                                              |
| `defaultMaxResponseBytes` | `262144`    | The largest response read (256 KB). An operation's `maxResponseBytes` overrides it.                                                 |
| `maxConcurrencyPerHost`   | `10`        | Requests in flight to one host; more wait their turn.                                                                               |
| `egressProxy`             |             | A proxy URL every request to your API goes through. Needs `undici` on Node.js.                                                      |
| `errorBodies`             | `'include'` | `'include'` adds your API's error body, redacted and cut to 2 KB, to a failed call's error; `'status-only'` names the status alone. |

### Sources

| `type`   | Fields                                                                                                        | What it does                                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inline` | `content`                                                                                                     | The bundle object itself. For tests, bundles built in code, and runtimes without a file system.                                                                                                                                              |
| `static` | `path`, `watch?`                                                                                              | A JSON or YAML bundle file, resolved from the working directory. With `watch: true`, the plugin reloads it when it changes.                                                                                                                  |
| `npm`    | `packageName`, `exportName?`, `verifyProvenance?`                                                             | Imports a package and uses one of its exports. Provenance checks aren't implemented yet, so the default `verifyProvenance: true` refuses to load it; set `false` only for a package you pin and trust.                                       |
| `saas`   | `endpoint`, `authToken`, `expectedAudience`, `jwksUrl`, `expectedIssuer`, `pollIntervalMs?`, `enableWebhook?` | Pulls the bundle over HTTPS at startup and every `pollIntervalMs` (default 5 minutes), after checking `authToken` against `jwksUrl`, `expectedIssuer` and `expectedAudience`. With `enableWebhook: true`, also takes pushed bundles (below). |

A new bundle from `static` (with `watch`) or `saas` is checked like the first, then replaces the skills and operations
at once. A bundle that fails its checks isn't applied, and the reason is logged; the bundle already loaded stays.

A `static` file that fails to load at startup is still watched (with `watch: true`), and a `saas` source keeps polling
after a failed first pull, so the next good bundle loads without a restart.

### Pushed bundles

With `enableWebhook: true` on a `saas` source, the server takes bundles the SaaS pushes at
`POST /__skilled_openapi/push`, through the hookable `skilled-openapi:bundle-push` flow, on Node and on a Worker:

- The `Authorization: Bearer` token is checked as `authToken` is, and must also carry a `jti` of 8 or more characters
  that no push used and an `iat` within five minutes. A missing or refused token answers `401 invalid_token`, a used
  `jti` answers `409 push_replayed`, and a JWKS that can't be read answers `503 temporarily_unavailable`.
- The body is the bundle as JSON, checked as a pulled bundle is: `400 invalid_bundle` when it is not a bundle,
  `422 bundle_not_applied` when its signature or its other checks fail.
- An applied bundle answers `200 { applied: true, bundleId, bundleVersion }` and is kept as the last good bundle. Pushes
  and pulls apply one at a time, in the order they arrive.

The used `jti`s are kept in memory: replicas, and the isolates of a Worker, don't share them.

### When no bundle loads

If the bundle fails to load (a bad signature, a schema error, an unreachable source) and no bundle was loaded before,
the server keeps running, and:

- `search_skill`, `load_skill`, `execute_action` and `run_workflow` answer an error, code `SKILL_BUNDLE_NOT_LOADED`:
  `No skill bundle is loaded: <reason>`, for example
  `No skill bundle is loaded: bundle acme:billing@1.4.0 was not applied: unknown signing keyId "ci-2026" — not in trustedKeys allowlist`.
  The reason is the first line of the error, with each URL cut to its scheme, host and path, and tokens removed. The
  log has the full reason.
- `/readyz` answers 503: its `skilled-openapi` check is `unhealthy`, with the same reason in `error`.

Once a bundle loads (a watched file is fixed, a poll succeeds), the tools work again and the check is `healthy`, with
`details: { state: 'loaded', bundleId, bundleVersion }`.

### The bundle

A bundle is a JSON or YAML object with `schemaVersion`, `bundleId`, `version`, `services`, `authBindings`, `skills`,
`operations` and, when signed, `integrity`. YAML is read with the YAML 1.2 core schema, so it means what the same JSON
would: an unquoted timestamp such as `generatedAt: 2026-05-04T12:00:00.000Z`, as `yaml.stringify` writes it, stays
the string that was signed, and merge keys (`<<`) and tags such as `!!binary` aren't supported. A bundle can also be
wrapped in an OpenAPI Overlay document, under `info["x-frontmcp-bundle"]`, so it can live next to the spec it
describes. `compileSkilledBundleFromOpenApi()` from
`@frontmcp/adapters/skills` builds the services and operations from an OpenAPI spec, and the same entry point exports
`canonicalize()`, `bundleDigest()` and `verifyBundleSignature()` for signing in CI. See
[The bundle](https://frontmcp.dev/reference/plugins/skilled-openapi#the-bundle) for every field.

An operation it compiles checks a JSON answer against the schema of the operation's responses. A 2xx response the spec
documents with a description only, or with a media type that names no schema, accepts any answer; a 204, a 205 and a
`HEAD` operation stay bodyless. Several status codes give an `anyOf`, so an answer that fits more than one passes. Each
query parameter's `style` and `explode` are kept in the operation's `mapper`, and its requests follow them: by default
an array repeats its key (`ids=1&ids=2`), and `explode: false` joins it with commas. Up to 1.11.0 a description-only
response compiled to `{ "type": "null" }`, which every JSON answer failed, and every array was sent comma-joined.

## Security

- **Signing.** With `requireSignature` (the default), a bundle is applied only if its `integrity` signature, RS256 or
  EdDSA (Ed25519) over the bundle's canonical JSON, verifies with a key in `trustedKeys`. A signed bundle is still
  checked for shape: unknown fields are errors, and path templates and header names are restricted.
- **Authorization.** `requiredAuthorities` on skills and operations are checked on every `callTool` and `execute_action` call. Skills organize
  what the model reads; they don't limit what a script can call, so protect operations with rules and use
  `unprotectedOps: 'deny'` in production. Each caller is shown only the skills and actions their rules allow. A skill's
  rule doesn't protect an operation that another skill, without that rule, also lists: put the rule on the operation.
- **Credentials.** Credentials stay on the server: the plugin adds them to each request, and the script gets only the
  API's answer. With `authProviders`, a caller's request carries only that caller's credential, and one who hasn't
  connected it is asked to. Redirects aren't followed, so a credential isn't sent elsewhere. An error body your API
  echoes a credential in has it redacted; use `outbound.errorBodies: 'status-only'` when error bodies hold other
  internal details.
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
