---
name: configure-auth-modes
description: Detailed comparison of public, transparent, local, and remote auth modes
---

# Auth Modes Detailed Comparison

## Public Mode

No authentication required. All requests get anonymous access.

```typescript
auth: {
  mode: 'public',
  sessionTtl: 3600,
  anonymousScopes: ['read', 'write'],
  publicAccess: { tools: 'all', prompts: 'all' },
}
```

**Use when:** Development, internal tools, public APIs.

## Transparent Mode

Server validates tokens from an upstream identity provider. Does not issue or refresh tokens.

```typescript
auth: {
  mode: 'transparent',
  provider: 'https://auth.example.com',
  expectedAudience: 'my-api',
  // clientId is OPTIONAL and unused for pure JWT validation — transparent mode
  // never runs an OAuth code exchange, it only verifies tokens against the
  // provider's JWKS. Omit it unless you have a specific reason to set it.
}
```

**Use when:** Behind an API gateway or reverse proxy that handles auth.

> Transparent also accepts `allowAnonymous` (default `false`) + `anonymousScopes` (default `['anonymous']`) to admit tokenless requests as anonymous, and `requiredScopes` to reject tokens missing a scope. `expectedAudience` is shared across transparent/local/remote, not transparent-only.

> **Claim validation (transparent):** a valid JWKS signature alone does not bind a token to this server — every service behind the same IdP shares the signing keys. FrontMCP therefore validates the token `iss` against `provider` (plus any `providerConfig.additionalIssuers`, each matched with/without a trailing slash) **by default**, and validates `aud` against `expectedAudience` when the token carries one. This blocks replay of a token minted by the same IdP for a different issuer or audience. Set `providerConfig.additionalIssuers: ['https://gateway.example']` to trust a known extra issuer. `providerConfig.verifyIssuer: false` **disables the issuer check entirely** (accepts any issuer signed by the JWKS) — only for a trusted gateway whose re-minted issuer you cannot enumerate, and always paired with a strict `expectedAudience`.

## Local Mode

Built-in OAuth 2.1 server that signs its own JWT tokens. Full control over token lifecycle.

```typescript
auth: {
  mode: 'local',
  local: {
    issuer: 'https://mcp.example.com', // optional; request-host-derived otherwise
  },
  expectedAudience: 'my-api',
  // 'memory' (default, lost on restart) | { sqlite: { path } } | { redis: { ... } }
  tokenStorage: { sqlite: { path: './data/auth.sqlite' } },
  consent: { enabled: true }, // tool-selection screen at login + call-time enforcement
  incrementalAuth: { enabled: true }, // app-level gating + progressive expansion (opt-in)
}
```

Signing is **HS256 with a symmetric `JWT_SECRET`** (no key pair). Set a stable `JWT_SECRET` or tokens are invalidated on every restart. For a single operator (e.g. Claude Code), add `requireEmail: false` to skip the email prompt (a stable `sub` is derived from `anonymousSubject`, default `'local-operator'`).

Local mode also accepts `allowDefaultPublic` (default `false` — set `true` to admit tokenless requests as anonymous instead of returning 401), `anonymousScopes` (default `['anonymous']` — scopes for those anonymous sessions), and `expectedAudience` (reject tokens minted for a different `aud`).

> **Client registration (security):** by default an unregistered `client_id` is accepted with whatever `redirect_uri` it presents. Set `requireRegisteredClients: true` (local/remote) to require every client to be registered (DCR / `dcr.clients`) or a CIMD client-id URL, so `redirect_uri` is exact-matched (OAuth 2.1) — this prevents auth-code interception via an attacker-chosen redirect. Confidential clients (`token_endpoint_auth_method: client_secret_basic`/`client_secret_post`) are authenticated with a constant-time `client_secret` check on both the code-exchange and refresh grants (Basic header or body param).

> **Public origin (security):** pin `FRONTMCP_PUBLIC_URL` in production. The issuer / resource / OAuth-discovery URLs and the transparent expected audience derive from it rather than from request headers; `X-Forwarded-Host`/`X-Forwarded-Proto` are ignored unless `FRONTMCP_TRUST_PROXY=1` (a trusted proxy that strips client-supplied forwarded headers).

**Progressive / incremental authorization** (opt-in via `incrementalAuth`): when enabled, the minted token carries an `authorized_apps` claim and a `tools/call` for an app NOT in that claim resolves to a `CallToolResult` with `isError: true` and `_meta.code === 'AUTHORIZATION_REQUIRED'` (fields: `authorization_required: true`, `app`, `tool`, `auth_url`, `required_scopes`, `session_mode`, `supports_incremental`). The client declares the initial grant on `/oauth/authorize?…&apps=crm` (omit `apps` to grant all apps) and expands it later via an incremental authorize `…&mode=incremental&app=slack&apps=crm` — the new token's claim is the **union** of the prior apps plus the target (the user identity and already-granted apps are preserved; upstream tokens stay server-side). Without an `incrementalAuth` block, no claim is minted and there is **no** app-level gating (allow-all preserved). `consent` (tool-level) and `incrementalAuth` (app-level) are independent.

To collect and verify your own credentials, add a declarative `login` (custom page fields / title / subject strategy) and an `authenticate(input, ctx)` verifier that returns `{ ok: true, sub?, claims? }` (custom claims are embedded in the token; reserved claims are stripped) or `{ ok: false, message }` (re-renders the login page; no code issued). Both are optional and default to the built-in email login. See `configure-auth.md` for a full example.

To orchestrate **multiple upstream OAuth providers** (GitHub, Slack, Jira, …) declare a `providers` array — FrontMCP federates them at `/oauth/authorize`, refuses to mint a JWT until `federatedAuth.minProviders` (default `1`) are linked, stores each provider's tokens encrypted server-side, and exposes them to tools via `this.orchestration.getToken(id)`:

```typescript
auth: {
  mode: 'local',
  providers: [
    { id: 'github', authorizeUrl: '…', tokenUrl: '…', clientId: '…', scopes: ['repo'] },
    { id: 'slack', authorizeUrl: '…', tokenUrl: '…', clientId: '…' },
  ],
  federatedAuth: { minProviders: 1, requiredProviders: ['github'] }, // no JWT until linked
}
```

See `configure-auth.md` → "Multi-provider orchestration" for the full provider schema and the `this.orchestration` tool API.

**Use when:** Standalone servers with full auth control, development with local OAuth, orchestrating several upstream OAuth providers behind one MCP server.

## Remote Mode

FrontMCP runs a local OAuth 2.1 server that **proxies user authentication to one
mandatory upstream IdP**. `GET /oauth/authorize` redirects **straight to the
upstream IdP** — there is no FrontMCP login page and no provider-selection page.
After the IdP returns to `/oauth/provider/{id}/callback`, FrontMCP exchanges the
code, stores the upstream tokens encrypted (server-side), derives the session
identity (`sub`/`email`/`name`) from the **upstream user**, and mints its own
HS256 session token. Tools read the upstream token via
`this.orchestration.getToken('<provider-id>')`.

```typescript
auth: {
  mode: 'remote',
  provider: 'https://auth.example.com',
  clientId: 'my-client-id', // pre-registered (DCR not yet wired)
  clientSecret: process.env.AUTH_SECRET,
  scopes: ['openid', 'profile', 'email'],
  tokenStorage: { redis: { host: process.env['REDIS_HOST'] ?? 'localhost', port: 6379 } },
  // The provider id defaults to the `provider` hostname; pin a stable id (and/or
  // override non-standard endpoints) with providerConfig:
  providerConfig: { id: 'idp' },
}
```

Endpoints are derived from `provider` using standard OIDC paths
(`/authorize`, `/token`, `/userinfo`, `/.well-known/jwks.json`). For
non-standard IdPs, override them with
`providerConfig.{authEndpoint,tokenEndpoint,userInfoEndpoint,jwksUri}`.

**Deferred (not yet wired):** upstream **Dynamic Client Registration**
(`providerConfig.dcrEnabled` / `registrationEndpoint`) — a pre-registered
`clientId` is required; and upstream **token auto-refresh** — once the upstream
access token expires the user must re-authenticate (FrontMCP's own session token
still refreshes via the `refresh_token` grant).

**Use when:** Enterprise deployments delegating user authentication to a single
centralized IdP that may not support DCR, while keeping FrontMCP-issued sessions,
upstream-token access in tools, and an optional consent layer.

## Comparison Table

| Feature                  | Public        | Transparent     | Local                           | Remote                            |
| ------------------------ | ------------- | --------------- | ------------------------------- | --------------------------------- |
| Token issuance           | Anonymous JWT | None (upstream) | Self-signed (HS256)             | Self-signed (HS256)               |
| Signing                  | HS256 secret  | Upstream JWKS   | HS256 secret (`JWT_SECRET`)     | HS256 secret (`JWT_SECRET`)       |
| Session-token refresh    | No            | No              | Yes                             | Yes                               |
| Upstream-token refresh   | n/a           | n/a             | On-demand (when wired)          | Not yet wired (re-auth on expiry) |
| Identity source          | Anonymous     | Upstream token  | Login form / `authenticate()`   | Upstream IdP user                 |
| PKCE support             | No            | No              | Yes                             | Yes                               |
| Token persistence        | n/a           | n/a             | memory / sqlite / redis         | memory / sqlite / redis           |
| Consent (tool selection) | No            | No              | Optional (screen + enforcement) | Optional (screen + enforcement)   |
| Upstream OAuth providers | No            | No              | 0..N (declared `providers[]`)   | Exactly 1 (mandatory)             |

> "Remote" still issues its own HS256 session token to the MCP client; it delegates **user authentication** to a single upstream IdP rather than delegating token signing. `GET /oauth/authorize` redirects straight to that IdP (no in-tree login page), and tools read the upstream token via `this.orchestration.getToken(id)`.

## Examples

| Example                                                                                                        | Level        | Description                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`local-minimal`](../examples/configure-auth-modes/local-minimal.md)                                           | Basic        | Stand up the built-in local OAuth 2.1 server with the minimum configuration: HS256 signing via JWT_SECRET and in-memory token storage.                                                                      |
| [`local-self-signed-tokens`](../examples/configure-auth-modes/local-self-signed-tokens.md)                     | Intermediate | Configure a local-mode server that signs its own HS256 JWTs and persists auth state across restarts with SQLite or Redis.                                                                                   |
| [`local-single-operator`](../examples/configure-auth-modes/local-single-operator.md)                           | Basic        | Run local mode for a single operator (e.g. Claude Code) by skipping the email prompt and minting a stable anonymous subject.                                                                                |
| [`local-consent-enforcement`](../examples/configure-auth-modes/local-consent-enforcement.md)                   | Intermediate | Enable consent in local mode to render a tool-selection screen at login and enforce the chosen tools at call time, keeping essential tools always available via excludedTools.                              |
| [`local-behind-tunnel`](../examples/configure-auth-modes/local-behind-tunnel.md)                               | Intermediate | Expose a local-mode server through a tunnel or TLS proxy by aligning the token issuer with the public URL clients actually reach.                                                                           |
| [`local-multi-provider-orchestration`](../examples/configure-auth-modes/local-multi-provider-orchestration.md) | Advanced     | Orchestrate multiple upstream OAuth providers (GitHub + Slack) in local mode, gate the JWT until they are linked, and read downstream tokens in tools via this.orchestration.                               |
| [`local-dcr-control`](../examples/configure-auth-modes/local-dcr-control.md)                                   | Intermediate | Lock down the built-in Dynamic Client Registration endpoint with the auth.dcr control surface: disable open registration, allowlist redirect URIs and client ids, and seed a pre-registered trusted client. |
| [`remote-enterprise-oauth`](../examples/configure-auth-modes/remote-enterprise-oauth.md)                       | Advanced     | Proxy authentication to one mandatory upstream IdP, mint a FrontMCP session, and read the upstream token in tools.                                                                                          |
| [`transparent-jwt-validation`](../examples/configure-auth-modes/transparent-jwt-validation.md)                 | Basic        | Validate externally-issued JWTs without managing token lifecycle on the server.                                                                                                                             |

> See all examples in [`examples/configure-auth-modes/`](../examples/configure-auth-modes/)
