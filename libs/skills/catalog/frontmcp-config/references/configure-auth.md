---
name: configure-auth
description: Set up authentication modes, credential vault, and OAuth flows for FrontMCP servers
---

# Configure Authentication for FrontMCP

This skill covers setting up authentication in a FrontMCP server. FrontMCP supports four auth modes, each suited to different deployment scenarios. All authentication logic lives in the `@frontmcp/auth` library.

## When to Use This Skill

### Must Use

- Adding authentication to a new FrontMCP server for the first time
- Switching between auth modes (e.g., moving from `public` to `remote` for production)
- Configuring the credential vault to access downstream APIs on behalf of authenticated users

### Recommended

- Setting up multi-app auth where different `@App` instances need different security postures
- Configuring OAuth local dev flow for development against `remote` or `transparent` modes
- Adding audience validation or session TTL tuning to an existing auth setup

### Skip When

- You need to manage session storage backends (Redis, Vercel KV) -- use `configure-session` instead
- You are building a plugin that extends auth context -- use `create-plugin` instead

> **Decision:** Use this skill whenever you need to choose, configure, or change the authentication mode on a FrontMCP server.

## Auth Modes Overview

| Mode          | Use Case                                   | Token Issuer        |
| ------------- | ------------------------------------------ | ------------------- |
| `public`      | Open access with optional scoping          | None                |
| `transparent` | Validate externally-issued JWTs            | External provider   |
| `local`       | Server signs its own tokens                | The FrontMCP server |
| `remote`      | Full OAuth 2.1 flow with external provider | External provider   |

## Mode 1: Public

Public mode allows all connections without authentication. Use this for development or open APIs where access control is handled elsewhere.

```typescript
@App({
  auth: {
    mode: 'public',
    sessionTtl: 3600,
    anonymousScopes: ['read'],
  },
})
class MyApp {}
```

- `sessionTtl` -- session lifetime in seconds.
- `anonymousScopes` -- scopes granted to all unauthenticated clients.

## Mode 2: Transparent

Transparent mode validates JWTs issued by an external provider without initiating an OAuth flow. The server fetches the provider's JWKS to verify token signatures.

```typescript
@App({
  auth: {
    mode: 'transparent',
    provider: 'https://auth.example.com',
    expectedAudience: 'my-api',
  },
})
class MyApp {}
```

- `provider` -- the authorization server URL. FrontMCP fetches JWKS from `{provider}/.well-known/jwks.json`.
- `expectedAudience` -- the `aud` claim value that tokens must contain.

Use transparent mode when clients already have tokens from your identity provider and the server only needs to verify them.

## Mode 3: Local

Local mode runs a built-in OAuth 2.1 authorization server and signs its own JWT tokens. This is useful for internal services or environments where an external identity provider is not available.

```typescript
@FrontMcp({
  info: { name: 'internal-api', version: '1.0.0' },
  auth: {
    mode: 'local',
    local: {
      issuer: 'https://mcp.internal.example.com', // optional; auto-derived from request host otherwise
    },
  },
})
class Server {}
```

- `local.issuer` -- the `iss` claim set in generated tokens (defaults to a request-host-derived URL if omitted).

Token signing uses **HS256, a symmetric secret** read from the `JWT_SECRET` environment variable -- there is **no RSA/EC key pair** and no key store. Generate a stable secret (`JWT_SECRET=$(openssl rand -hex 32)`); if it is unset, FrontMCP falls back to a random per-process secret and all tokens are invalidated on restart.

Key local-mode options:

- `tokenStorage` -- where authorization codes / refresh tokens / federated sessions persist. Defaults to `'memory'` (lost on restart). Use `{ sqlite: { path } }` for single-node persistence or `{ redis: { ... } }` for multi-instance. This is honored in local mode.
- `requireEmail` (default `true`) -- when `false`, the login callback mints a code without prompting for an email, deriving a stable `sub` from `anonymousSubject` (default `'local-operator'`). Use for single-operator setups (e.g. Claude Code).
- `consent` -- enables an **interactive tool-selection screen** during login AND **call-time enforcement**. When `consent.enabled` is `true`, `/oauth/callback` renders a consent screen (after authentication) listing the available tools; the user's checked tools are GET-submitted back to `/oauth/callback`, embedded in the token's `consent` claim, and enforced on every `tools/call` — a call to an unselected tool is rejected with `TOOL_NOT_CONSENTED` (JSON-RPC `-32003`). Honored flags: `groupByApp` (default `true`), `showDescriptions` (default `true`), `allowSelectAll` (default `true`), `requireSelection` (default `true` — rejects an empty submit), `customMessage`, `rememberConsent` (default `true`), `excludedTools` (never offered, always available), `defaultSelectedTools` (pre-checked). Federated logins show the screen after the last provider links. Tokens minted without consent (disabled, or via the test factory) carry no claim and stay all-tools-allowed. `rememberConsent` persists each user's per-client selection (keyed by `consent:{userSub}:{clientId}`, sharing the configured `tokenStorage` backend) and reuses it on the next login: the screen is skipped when no new tool appeared, or re-shown pre-filled when a NEW tool was added (a newly-added tool is never silently granted). Set `rememberConsent: false` to always re-show the screen.
- `login` -- customize the built-in login page: `title` / `subtitle` / `logoUri`, declarative `fields` (each `{ type: 'text'|'password'|'email'|'select'|'hidden'; label?; required?; placeholder?; options? }`), a full HTML `render(ctx)` override, and a `subject` strategy (`{ fromField, strategy: 'per-session'|'per-account' }`). Omitting `login` keeps the default email/name page.
- `authenticate(input, ctx)` -- custom verification run at the login callback **before** a token is minted. `input.fields` carries the submitted login fields (reserved OAuth params excluded); `ctx` is `{ get, fetch, logger, clientId?, clientName? }`. Return `{ ok: true, sub?, claims? }` to mint a token (custom `claims` are embedded in the JWT; reserved claims like `sub`/`iss`/`exp`/`scope` are stripped) or `{ ok: false, message, retryField? }` to re-render the login page with the error (no code issued). When set, the email requirement no longer applies.
- `providers` -- declarative upstream OAuth providers (GitHub, Slack, Jira, …) to orchestrate. When set, FrontMCP federates them at `/oauth/authorize`, stores each provider's tokens **encrypted server-side**, and exposes them to tools via `this.orchestration.getToken(id)`. See [Multi-provider orchestration](#multi-provider-orchestration-providers--federatedauth) below.
- `federatedAuth` -- gates JWT issuance during federated login: `minProviders` (default `1` when `providers` are set — "no JWT until ≥1 linked"), `requiredProviders` (ids that must all be linked), and `stateValidation` (`'strict'` default).

### Multi-provider orchestration (`providers` + `federatedAuth`)

Declare upstream providers to make multi-provider orchestration a turnkey local default. No JWT is minted until the `minProviders` threshold (and every `requiredProviders` id) is met; linked providers' tokens are read by tools via `this.orchestration`.

```typescript
@FrontMcp({
  info: { name: 'internal-api', version: '1.0.0' },
  auth: {
    mode: 'local',
    providers: [
      {
        id: 'github',
        // `authorizeUrl`/`tokenUrl` are accepted aliases for
        // `authorizationEndpoint`/`tokenEndpoint`.
        authorizeUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        clientId: process.env.GITHUB_CLIENT_ID!,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        scopes: ['read:user', 'repo'],
      },
      { id: 'slack', authorizeUrl: '…', tokenUrl: '…', clientId: '…', scopes: ['users:read'] },
    ],
    federatedAuth: { minProviders: 1, requiredProviders: ['github'] },
  },
})
class Server {}
```

`UpstreamProviderOptions` fields: `id` (required; used in `getToken(id)`), `authorizationEndpoint`/`authorizeUrl` (required), `tokenEndpoint`/`tokenUrl` (required), `clientId` (required), `clientSecret?`, `scopes?`, `name?`, `userInfoEndpoint?`, `jwksUri?`. The per-provider callback URL is auto-computed as `${issuer}/oauth/provider/${id}/callback` — register that URL with each provider.

Tools read downstream tokens through the `this.orchestration` context extension (available in `local`/`remote` mode):

```typescript
@Tool({ name: 'github_repos' })
class GitHubReposTool extends ToolContext {
  async execute() {
    if (!this.orchestration.isAuthenticated) return { error: 'not authenticated' };
    const token = await this.orchestration.getToken('github'); // throws if not linked
    const maybe = await this.orchestration.tryGetToken('slack'); // null if skipped
    const res = await fetch('https://api.github.com/user/repos', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { repos: await res.json() };
  }
}
```

Tokens stay server-side and AES-256-GCM-encrypted at rest — never placed in the JWT or exposed to the model. No login PII is stored (only provider tokens + non-PII provider ids).

### Custom login + verification (`login` / `authenticate`)

```typescript
@FrontMcp({
  info: { name: 'internal-api', version: '1.0.0' },
  auth: {
    mode: 'local',
    login: {
      title: 'Sign in with your API key',
      fields: { apiKey: { type: 'password', label: 'API Key', required: true } },
      subject: { fromField: 'apiKey', strategy: 'per-account' }, // stable sub per key
    },
    authenticate: async (input, ctx) => {
      const res = await ctx.fetch('https://api.example.com/verify', {
        method: 'POST',
        headers: { authorization: `Bearer ${input.fields.apiKey}` },
      });
      if (!res.ok) return { ok: false, message: 'Invalid API key', retryField: 'apiKey' };
      const { accountId, tier } = (await res.json()) as { accountId: string; tier: string };
      return { ok: true, sub: accountId, claims: { tenantId: accountId, plan: tier } };
    },
  },
})
class Server {}
```

### Per-session credential vault (`this.credentials`)

An `{ ok: true }` result may return `credentials: Array<{ key; secret; metadata? }>`. FrontMCP **persists** these into a built-in, **AES-256-GCM-encrypted**, per-session vault keyed by the authenticated `sub`, and exposes them to tools via `this.credentials`. The vault is enabled automatically in `local` (and `remote`) modes — no wiring required. (This is distinct from `this.authProviders`, which is opt-in scaffolding for downstream OAuth providers — see below.)

```typescript
auth: {
  mode: 'local',
  login: { fields: { apiKey: { type: 'password', label: 'API Key', required: true } } },
  authenticate: async (input) => {
    const apiKey = input.fields['apiKey'];
    if (!(await isValid(apiKey))) return { ok: false, message: 'Invalid API key' };
    // Persisted, encrypted, keyed by the minted `sub`:
    return { ok: true, credentials: [{ key: 'acme', secret: apiKey, metadata: { baseUrl: 'https://acme.example' } }] };
  },
}
```

Read them from any tool:

```typescript
@Tool({ name: 'call_acme' })
class CallAcmeTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    const cred = await this.credentials.get('acme'); // { secret, metadata } | undefined
    if (!cred) {
      const res = await this.credentials.requireConnect({ key: 'acme' });
      if (!res.connected) return { connectUrl: res.resumeUrl }; // framework-signed /oauth/connect URL
    }
    const keys = await this.credentials.list();
    // use cred.secret / cred.metadata …
  }
}
```

`this.credentials` API:

- `get(key)` -> `Promise<{ secret, metadata } | undefined>` — decrypt a credential for the request's subject.
- `list()` -> `Promise<string[]>` — credential keys in the current session vault.
- `requireConnect({ key, context? })` -> returns the credential when connected, else a **framework-signed**, short-lived `/oauth/connect?token=…` resume URL. Opening it renders a single-field add-credential page (reusing `login.fields`); on submit FrontMCP re-invokes `authenticate()` with a `resume: { sub, key, context }` context and **additively** stores the returned credential into the existing session vault. A rotated-away (dead) session is refused.

Security: per-record AES key derived (HKDF) from a fresh per-session `vaultId` + a pepper from `VAULT_SECRET ?? JWT_SECRET` (random per-process fallback, logged with a warning — credentials then do not survive a restart, never plaintext). A disconnect + reconnect rotates the `vaultId`, so the reconnected session sees an **empty vault** and old ciphertext is undecryptable. The vault is backed by the same `auth.tokenStorage` backend (memory / Redis / SQLite). No login PII is stored.

## Mode 4: Remote

Remote mode performs a full OAuth 2.1 authorization flow with an external provider. Clients are redirected to the provider for authentication and return with an authorization code.

```typescript
@App({
  auth: {
    mode: 'remote',
    provider: 'https://auth.example.com',
    clientId: 'xxx',
  },
})
class MyApp {}
```

- `provider` -- the OAuth 2.1 authorization server URL.
- `clientId` -- the OAuth client identifier registered with the provider.

## OAuth Local Dev Flow

For local development with `remote` or `transparent` mode, you can skip the full OAuth flow by setting the environment to development:

```typescript
@App({
  auth: {
    mode: 'remote',
    provider: 'https://auth.example.com',
    clientId: 'dev-client-id',
  },
})
class MyApp {}
```

When `NODE_ENV=development`, FrontMCP relaxes token validation to support local identity provider instances (e.g., a local Keycloak or mock OAuth server). Tokens are still validated, but HTTPS requirements and strict issuer checks are loosened.

## Multi-App Auth

Each `@App` in a FrontMCP server can have a different auth configuration. This is useful when a single server hosts multiple logical applications with different security requirements:

```typescript
@App({
  name: 'public-api',
  auth: {
    mode: 'public',
    sessionTtl: 3600,
    anonymousScopes: ['read'],
  },
  tools: [PublicSearchTool, PublicInfoTool],
})
class PublicApi {}

@App({
  name: 'admin-api',
  auth: {
    mode: 'remote',
    provider: 'https://auth.example.com',
    clientId: 'admin-client',
  },
  tools: [AdminTool, ConfigTool],
})
class AdminApi {}
```

## Credential Vault (`this.authProviders`)

The credential vault and its `this.authProviders` accessor are intended to surface downstream API tokens to tools. The accessor and the underlying vault primitives exist in `@frontmcp/auth`, but they are **scaffolding** — the vault must be explicitly configured/registered with providers before `this.authProviders` resolves. It is **not** turnkey-wired for `local` mode (or auto-populated by simply setting `auth.mode`), so do not assume credentials appear automatically from configuring an auth mode.

When the vault is configured with registered providers, tools read credentials via the `this.authProviders` context extension:

```typescript
@Tool({ name: 'create_github_issue' })
class CreateGithubIssueTool extends ToolContext {
  async execute(input: { title: string; body: string }) {
    // Resolves only when the AuthProviders vault is configured with providers.
    const github = await this.authProviders.get('github');
    const headers = await this.authProviders.headers('github');
    // Use headers to call GitHub API
  }
}
```

The `authProviders` accessor (from `@frontmcp/auth`) exposes:

- `get(provider)` -- get the credential/token for a provider.
- `headers(provider)` -- get pre-formatted auth headers for HTTP requests.
- `has(provider)` -- check if a provider is configured.
- `refresh(provider)` -- force refresh the credential.

If the vault is not configured, accessing `this.authProviders` throws (`AuthProvidersNotConfiguredError`).

## Common Patterns

| Pattern                     | Correct                                                                        | Incorrect                                                       | Why                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Session store in production | Use Redis or Vercel KV session store                                           | Use default in-memory session store                             | Sessions are lost on restart; in-memory does not survive process recycling                 |
| Secret management           | Load `clientId`, vault secrets, and Redis passwords from environment variables | Hardcode secrets in source code                                 | Hardcoded secrets leak into version control and are difficult to rotate                    |
| Audience validation         | Always set `expectedAudience` in transparent/remote mode                       | Omit the audience field                                         | Without audience validation, tokens issued for any audience would be accepted              |
| Auth mode for development   | Use `public` mode or local OAuth mock for dev environments                     | Use `remote` mode pointing at production IdP during development | Avoids accidental production token usage and simplifies local iteration                    |
| Local-mode signing secret   | Set a stable `JWT_SECRET` (e.g. `openssl rand -hex 32`) in env                 | Leave `JWT_SECRET` unset in a long-lived deployment             | Unset means a random per-process HS256 secret; every restart invalidates all issued tokens |

## Verification Checklist

**Configuration**

- [ ] Auth mode is set to the correct value for the deployment target (`public`, `transparent`, `local`, or `remote`)
- [ ] `provider` URL is set when using `transparent` or `remote` mode
- [ ] `clientId` is configured when using `remote` mode
- [ ] `expectedAudience` is set when using `transparent` mode

**Security**

- [ ] No secrets are hardcoded in source files -- all loaded from environment variables
- [ ] `JWT_SECRET` is set to a stable strong random value when using `local`/`remote` mode (otherwise tokens are invalidated on every restart)
- [ ] Production deployments use Redis or Vercel KV for session storage, not in-memory

**Runtime**

- [ ] Server starts without auth-related errors in the console
- [ ] Tokens are validated correctly (test with a valid and an invalid token)
- [ ] Downstream credential vault returns tokens for configured providers
- [ ] Multi-app configurations route requests to the correct auth mode per app

## Troubleshooting

| Problem                                 | Cause                                                                          | Solution                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `JWKS fetch failed` error on startup    | The `provider` URL is unreachable or does not serve `/.well-known/jwks.json`   | Verify the provider URL is correct and accessible from the server; check network/firewall rules                    |
| Tokens rejected with `invalid audience` | The `expectedAudience` value does not match the `aud` claim in the token       | Align the `expectedAudience` config with the audience value your identity provider sets in tokens                  |
| Sessions lost after server restart      | Using the default in-memory session store in production                        | Switch to Redis or Vercel KV session store via `configure-session` reference                                       |
| Local-mode tokens invalid after restart | `JWT_SECRET` unset (random per-process secret) and/or `tokenStorage: 'memory'` | Set a stable `JWT_SECRET`; use `tokenStorage: { sqlite: { path } }` or `{ redis }` to persist codes/refresh tokens |
| OAuth redirect fails in local dev       | `remote` mode requires HTTPS and reachable callback URLs                       | Set `NODE_ENV=development` to relax HTTPS requirements, or use a local OAuth mock server                           |

## Examples

| Example                                                                            | Level        | Description                                                                                                                                                |
| ---------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`multi-app-auth`](../examples/configure-auth/multi-app-auth.md)                   | Advanced     | Configure a single FrontMCP server with multiple apps, each using a different auth mode -- public for open endpoints and remote for admin endpoints.       |
| [`public-mode-setup`](../examples/configure-auth/public-mode-setup.md)             | Basic        | Set up a FrontMCP server with public (unauthenticated) access and anonymous scopes.                                                                        |
| [`remote-oauth-with-vault`](../examples/configure-auth/remote-oauth-with-vault.md) | Intermediate | Configure a FrontMCP server with remote OAuth 2.1 authentication and use the credential vault to call downstream APIs on behalf of the authenticated user. |
| [`local-credential-vault`](../examples/configure-auth/local-credential-vault.md)   | Intermediate | Persist a per-session credential from a local authenticate() verifier into the built-in encrypted vault and read it from a tool via this.credentials.      |

> See all examples in [`examples/configure-auth/`](../examples/configure-auth/)

## Reference

- Docs: [Authentication Overview](https://docs.agentfront.dev/frontmcp/authentication/overview)
- Related skills: `configure-session`, `create-plugin`
