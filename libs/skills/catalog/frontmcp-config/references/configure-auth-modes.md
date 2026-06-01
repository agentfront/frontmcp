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
  clientId: 'my-client-id',
}
```

**Use when:** Behind an API gateway or reverse proxy that handles auth.

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
  consent: { enabled: true }, // tool-authz enforcement; no picker UI yet
  incrementalAuth: { enabled: true },
}
```

Signing is **HS256 with a symmetric `JWT_SECRET`** (no key pair). Set a stable `JWT_SECRET` or tokens are invalidated on every restart. For a single operator (e.g. Claude Code), add `requireEmail: false` to skip the email prompt (a stable `sub` is derived from `anonymousSubject`, default `'local-operator'`).

**Use when:** Standalone servers with full auth control, development with local OAuth.

## Remote Mode

Server delegates to an upstream auth orchestrator for token management.

```typescript
auth: {
  mode: 'remote',
  provider: 'https://auth.example.com',
  clientId: 'my-client-id',
  clientSecret: process.env.AUTH_SECRET,
  tokenStorage: { redis: { host: process.env['REDIS_HOST'] ?? 'localhost', port: 6379 } },
}
```

**Use when:** Enterprise deployments with centralized identity management.

## Comparison Table

| Feature                | Public        | Transparent     | Local                       | Remote                      |
| ---------------------- | ------------- | --------------- | --------------------------- | --------------------------- |
| Token issuance         | Anonymous JWT | None (upstream) | Self-signed (HS256)         | Self-signed (HS256)         |
| Signing                | HS256 secret  | Upstream JWKS   | HS256 secret (`JWT_SECRET`) | HS256 secret (`JWT_SECRET`) |
| Token refresh          | No            | No              | Yes                         | Yes                         |
| PKCE support           | No            | No              | Yes                         | Yes                         |
| Token persistence      | n/a           | n/a             | memory / sqlite / redis     | memory / sqlite / redis     |
| Tool-authz enforcement | No            | No              | Optional (no picker UI)     | Optional (no picker UI)     |
| Federated auth         | No            | No              | Optional                    | Optional                    |

> "Remote" still issues its own HS256 session token to the MCP client; it delegates **user authentication** to the upstream IdP rather than delegating token signing.

## Examples

| Example                                                                                        | Level        | Description                                                                                                                             |
| ---------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| [`local-minimal`](../examples/configure-auth-modes/local-minimal.md)                           | Basic        | Stand up the built-in local OAuth 2.1 server with the minimum configuration: HS256 signing via JWT_SECRET and in-memory token storage.  |
| [`local-self-signed-tokens`](../examples/configure-auth-modes/local-self-signed-tokens.md)     | Intermediate | Configure a local-mode server that signs its own HS256 JWTs and persists auth state across restarts with SQLite or Redis.               |
| [`local-single-operator`](../examples/configure-auth-modes/local-single-operator.md)           | Basic        | Run local mode for a single operator (e.g. Claude Code) by skipping the email prompt and minting a stable anonymous subject.            |
| [`local-consent-enforcement`](../examples/configure-auth-modes/local-consent-enforcement.md)   | Intermediate | Enable consent in local mode to enforce a per-token authorized-tools claim, keeping essential tools always available via excludedTools. |
| [`local-behind-tunnel`](../examples/configure-auth-modes/local-behind-tunnel.md)               | Intermediate | Expose a local-mode server through a tunnel or TLS proxy by aligning the token issuer with the public URL clients actually reach.       |
| [`remote-enterprise-oauth`](../examples/configure-auth-modes/remote-enterprise-oauth.md)       | Advanced     | Delegate authentication to an external OAuth orchestrator with Redis-backed token storage.                                              |
| [`transparent-jwt-validation`](../examples/configure-auth-modes/transparent-jwt-validation.md) | Basic        | Validate externally-issued JWTs without managing token lifecycle on the server.                                                         |

> See all examples in [`examples/configure-auth-modes/`](../examples/configure-auth-modes/)
