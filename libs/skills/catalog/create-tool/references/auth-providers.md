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
    // `cloud` is the alias for the optional `aws` provider:
    const cloudHeaders = (await this.authProviders.tryHeaders('cloud')) ?? null;
    // …
  }
}
```

### Fields

| Field      | Type       | Default  | Meaning                                                                                                                                                       |
| ---------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`     | `string`   | —        | Must match a registered `@AuthProvider` on the server                                                                                                         |
| `required` | `boolean`  | `true`   | If `true`, the tool fails before `execute()` runs when no credentials are available. If `false`, the call proceeds; check via `this.authProviders.tryHeaders` |
| `scopes`   | `string[]` | —        | Required OAuth scopes. The framework triggers incremental auth if the session lacks them                                                                      |
| `alias`    | `string`   | = `name` | Local name for the provider — useful when two tools want the same provider under different labels                                                             |

## When auth is missing

For a `required: true` provider with no credentials:

1. The framework throws `AuthRequiredError` BEFORE `execute()` runs.
2. The client receives an MCP error with code `-32001` and `data.authUrl` pointing at the OAuth start URL.
3. The user completes the OAuth flow.
4. The client retries the tool call.

This is handled by the framework — you don't write any of this in `execute()`.

## Reading auth in execute()

Two patterns:

### A. Pre-formatted headers (most common)

```typescript
const headers = await this.authProviders.headers('github');
const response = await this.fetch(url, { headers });
```

`headers(name)` throws if creds aren't available (only safe to call inside a tool that declared the provider as `required: true`).

`tryHeaders(name)` returns `Headers | null` — for `required: false` providers.

### B. Raw token (for non-HTTP transports — gRPC, WebSocket, custom)

```typescript
const token = await this.authProviders.token('github');
// token: { value: string, type: 'bearer' | 'basic' | … }
```

### C. Full credential record (vault access)

```typescript
const creds = await this.authProviders.get('github');
// { accessToken, refreshToken?, expiresAt?, scopes, … }
```

Use the highest-level API that works (headers > token > full record) — the framework can short-circuit refresh / vault round-trips for the simpler APIs.

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
