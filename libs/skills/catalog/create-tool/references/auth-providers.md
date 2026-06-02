---
name: auth-providers
description: authProviders shorthand vs full mapping, scopes, alias, credential vault basics.
---

# `authProviders`

Declare which OAuth (or static-credential) providers a tool requires. Credentials are loaded **before** `execute()` runs — by the time your code runs, the headers / tokens are already available via `this.authProviders.headers(name)`.

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
| `name`     | `string`   | —        | Must match a registered credential provider on the server                                                                                                                                                                                           |
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

3. The user opens the URL and connects the credential.
4. The client retries the tool call — the gate now passes and `execute()` runs.

This is handled by the framework — you don't write any of this in `execute()`.

> The gate is a no-op (no new errors) for tools with no `authProviders`, for
> `required: false` providers, and for unauthenticated / public / no-credential-vault
> requests — so adding `authProviders` never changes behavior unless a credential
> vault is actually configured and a required credential is genuinely missing.

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

For session-specific secrets the user types in (vs OAuth flows), use the credential vault:

```typescript
@Tool({
  name: 'send_to_slack',
  authProviders: ['slack-webhook'], // a vault-backed provider
})
class SendToSlackTool extends ToolContext {
  async execute(input: { message: string }) {
    const headers = await this.authProviders.headers('slack-webhook');
    // headers contains the webhook URL the user pasted in earlier:
    // { 'x-slack-webhook-url': 'https://hooks.slack.com/services/…' }
    // …
  }
}
```

The vault is encrypted at rest (per-session AES-256-GCM key) and never leaves the server. See the `auth` skill for vault setup, OAuth provider registration, and the credential UI.

## See also

- [`13-tool-with-single-auth-provider`](../examples/13-tool-with-single-auth-provider.md)
- [`14-tool-with-multiple-auth-providers`](../examples/14-tool-with-multiple-auth-providers.md)
- [`15-tool-with-credential-vault`](../examples/15-tool-with-credential-vault.md)
- `auth` skill — provider registration, vault, OAuth flows
