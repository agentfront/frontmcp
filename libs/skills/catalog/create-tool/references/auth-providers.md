---
name: auth-providers
description: authProviders shorthand vs full mapping, scopes, alias, credential vault basics.
---

# `authProviders`

Declare which OAuth (or static-credential) providers a tool requires. Credentials are loaded **before** `execute()` runs — by the time your code runs, the headers / tokens are already available via `this.authProviders.headers(name)`.

## Registering providers

`this.authProviders` reads the providers the server registers in `@FrontMcp({ authProvidersVault })`. Each one has a
`name`, a `scope`, a `loading` strategy and the `factory` that acquires its credential:

```typescript
@FrontMcp({
  info: { name: 'github-tools', version: '1.0.0' },
  apps: [MainApp],
  authProvidersVault: {
    providers: [
      {
        name: 'github',
        scope: 'user', // 'global': one for the server; 'user': per signed-in user; 'session': per session
        loading: 'lazy',
        factory: async ({ userSub }) => {
          const token = userSub ? await githubTokenOf(userSub) : undefined;
          return token ? { type: 'bearer', token } : null; // null: not available
        },
        refresh: async ({ userSub, existingCredential }) => renewGithubToken(userSub, existingCredential), // optional
      },
    ],
  },
})
export default class Server {}
```

- The factory gets the caller's `userSub`, `userEmail`, `userName` and `sessionId`, and returns a credential
  (`bearer`, `oauth`, `api_key`, `basic`, `custom`, …) or `null`.
- A credential is cached for the request, and for the requests of a verified session on a single-instance server.
  Nothing is stored between them, so the factory runs again for a new request or session.
- A provider name listed twice is refused at startup (`CredentialProviderAlreadyRegisteredError`), and so is a
  provider entry with a field it doesn't take.
- On a server without `authProvidersVault`, `this.authProviders.get(name)` and `headers(name)` throw
  `AuthProvidersNotConfiguredError`, naming the provider.
- A name the vault doesn't register answers `null` (`headers()`: `{}`), so the session credential vault can answer
  for it instead (see "Credential vault" below).

## String shorthand (single required provider)

```typescript
@Tool({
  name: 'create_issue',
  description: 'Create a GitHub issue',
  inputSchema,
  outputSchema,
  authProviders: ['github'],
})
class CreateIssueTool extends ToolContext {
  async execute(input: CreateIssueInput) {
    const headers = await this.authProviders.headers('github');
    const response = await this.fetch('https://api.github.com/repos/.../issues', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ title: input.title, body: input.body }),
    });
    return response.json();
  }
}
```

`headers('github')` returns `{ Authorization: 'Bearer …' }` (or similar, depending on the provider). The framework handles refresh, expiration, and storage.

## Full mapping form

For scopes, required-vs-optional, or aliases:

```typescript
@Tool({
  name: 'deploy_app',
  description: 'Deploy a service to cloud',
  inputSchema,
  outputSchema,
  authProviders: [
    { name: 'github', required: true, scopes: ['repo', 'workflow'] },
    { name: 'aws', required: false, alias: 'cloud' }, // optional; injected as `cloud`
  ],
})
class DeployAppTool extends ToolContext {
  async execute(input: DeployInput) {
    const githubHeaders = await this.authProviders.headers('github');
    // `cloud` is the alias for the optional `aws` provider. `headers()` yields
    // an empty object `{}` when the optional credential isn't available:
    const cloudHeaders = await this.authProviders.headers('cloud');
    const hasCloud = Object.keys(cloudHeaders).length > 0;
    // …
  }
}
```

### Fields

| Field      | Type       | Default  | Meaning                                                                                                                                                                                                                                             |
| ---------- | ---------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`     | `string`   | —        | A provider in `@FrontMcp({ authProvidersVault })`, or a key of the session credential vault (`this.credentials`)                                                                                                                                    |
| `required` | `boolean`  | `true`   | If `true`, the tool fails before `execute()` runs when no credentials are available (call-time gate). If `false`, the call proceeds; `this.authProviders.headers(name)` returns `{}` (empty) when absent — check with `Object.keys(...).length > 0` |
| `scopes`   | `string[]` | —        | Required OAuth scopes. Advertised in the server's Protected Resource Metadata (`scopes_supported`, RFC 9728) so clients know to request them                                                                                                        |
| `alias`    | `string`   | = `name` | Local name for the provider — useful when two tools want the same provider under different labels                                                                                                                                                   |

`required` and `scopes` are independent axes: **`required` gates at call time** (a missing credential aborts the call before `execute()`), while **`scopes` feed PRM advertising** so the OAuth client knows which scopes the server's tools need.

## When auth is missing

For a `required: true` provider with no credentials, the framework's call-tool
flow runs a credential gate **before** `execute()`:

1. The framework aborts the call BEFORE `execute()` runs.
2. The client receives a JSON-RPC error with **code `-32001`** (MCP `UNAUTHORIZED`)
   and this `data` payload:

   ```json
   {
     "tool": "deploy_app",
     "providers": ["github"],
     "authUrl": "https://your-server/oauth/connect?token=…",
     "auth_url": "https://your-server/oauth/connect?token=…"
   }
   ```

   - `tool` — the tool that was gated.
   - `providers` — every required provider whose credential is missing.
   - `authUrl` / `auth_url` — the same connect/authorize URL under both the
     camelCase key (primary) and the snake_case key (matching the app-level
     `authorization_required` error), so either convention resolves. Present
     when the framework can mint a connect URL for the session.
   - `signInRequired: true` — set instead of `authUrl` when the caller isn't
     signed in: no connect URL works before sign-in, so none is given.

   The message names the provider and points at the data, never holding the
   URL: clients echo messages into transcripts and logs, and the signed link
   lets whoever holds it connect a credential for the caller for 10 minutes.

   ```text
   Tool "deploy_app" requires credentials for github which are not connected for this session. Connect github to continue: open the link in this error's data (authUrl).
   Tool "deploy_app" requires credentials for github, and this caller isn't signed in. Sign in to this server, then connect github.
   ```

3. The user opens the URL and connects the credential. A signed-in caller who has no credential vault yet gets one
   created there.
4. The client retries the tool call — the gate now passes and `execute()` runs.

A client that declared URL-mode elicitation (`capabilities.elicitation.url`) is
asked to open the connect page instead (`elicitation/create` with `mode: 'url'`
and the URL), on a server with `elicitation: { enabled: true }`. When the user
accepts, the gate checks again and the call runs if the credential is now
connected; otherwise it answers the same `-32001`. On protocol 2026-07-28 the
question travels as an `input_required` result under the key
`connect-<provider>`, and the client's retry carries the answer. A caller who
has to sign in first isn't asked.

This is handled by the framework — you don't write any of this in `execute()`.

> The gate is a no-op (no new errors) for tools with no `authProviders`, for
> `required: false` providers, and on a server with neither `authProvidersVault` nor
> the session credential vault (local / remote modes) — so adding `authProviders`
> never changes behavior unless one of them is configured and a required credential
> is genuinely missing. It checks the `authProvidersVault` provider of that name
> first, then the session credential vault's key.

`@frontmcp/plugin-skilled-openapi` reads the same providers for a bundle's auth
bindings: `SkilledOpenApiPlugin.init({ authProviders: { 'billing-token': 'billing' } })`
sends each caller the credential they connected as `billing`, and a caller who
hasn't connected it gets the same `-32001` error, from the action that needed it.
A `vaultRef` listed in both its `credentials` and `authProviders` is refused at
startup (`VaultRefListedTwiceError`).

## Reading auth in execute()

Two patterns:

### A. Pre-formatted headers (most common)

```typescript
const headers = await this.authProviders.headers('github');
const response = await this.fetch(url, { headers });
```

`headers(name)` returns a plain `Record<string, string>` (NOT a `Headers` object — read values with `headers['x-foo']`, not `headers.get(...)`). It never throws: when no credential is available it returns an empty object `{}`. For a `required: true` provider the framework already guaranteed creds before `execute()` ran, so it's non-empty; for a `required: false` provider, guard with `Object.keys(headers).length > 0`.

### B. Raw token / credential fields (for non-HTTP transports — gRPC, WebSocket, custom)

```typescript
const resolved = await this.authProviders.get('github');
// resolved is `ResolvedCredential | null`:
//   { credential, providerId, acquiredAt, expiresAt?, isValid, scope }
// The token lives under `.credential`. For an oauth provider:
const accessToken = resolved?.credential.accessToken;
```

### C. Full credential record (vault access)

```typescript
const resolved = await this.authProviders.get('github');
// resolved?.credential is the typed credential, e.g. for oauth:
//   { type: 'oauth', accessToken, refreshToken?, expiresAt?, tokenType, … }
```

Use the highest-level API that works (headers > full credential record via `get`) — `headers()` can short-circuit refresh / vault round-trips and formats the auth header for you.

## Credential vault

For session-specific secrets the user types in (vs credentials the server acquires), use the session credential
vault, `this.credentials`. Local mode's `authenticate()` fills it, and `authProviders` gates on its keys:

```typescript
@Tool({
  name: 'send_to_slack',
  authProviders: ['slack-webhook'], // a key the caller connected at sign-in
})
class SendToSlackTool extends ToolContext {
  async execute(input: { message: string }) {
    const webhook = await this.credentials.get('slack-webhook'); // { secret, metadata } | undefined
    // webhook.secret is the URL the user pasted in: 'https://hooks.slack.com/services/…'
    // …
  }
}
```

The vault is encrypted at rest (per-session AES-256-GCM key) and never leaves the server. See
[`15-tool-with-credential-vault`](../examples/15-tool-with-credential-vault.md) for the `authenticate()` that stores
the webhook, and the `configure-auth` reference for `requireConnect()` and the encryption key.

## See also

- [`13-tool-with-single-auth-provider`](../examples/13-tool-with-single-auth-provider.md)
- [`14-tool-with-multiple-auth-providers`](../examples/14-tool-with-multiple-auth-providers.md)
- [`15-tool-with-credential-vault`](../examples/15-tool-with-credential-vault.md)
- `configure-auth` reference — the session credential vault, OAuth flows
