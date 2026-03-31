---
name: configure-auth-modes
description: Detailed comparison of public, transparent, remote, and managed auth modes
---

# Auth Modes Detailed Comparison

## Public Mode

No authentication required. All requests get anonymous access.

```typescript
auth: {
  mode: 'public',
  sessionTtl: 3600,
  anonymousScopes: ['read', 'write'],
  publicAccess: { tools: true, resources: true, prompts: true },
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

Server signs its own JWT tokens. Full control over token lifecycle.

```typescript
auth: {
  mode: 'local',
  local: {
    issuer: 'my-server',
    audience: 'my-api',
  },
  tokenStorage: 'redis',
  consent: { enabled: true },
  incrementalAuth: { enabled: true },
}
```

**Use when:** Standalone servers with full auth control, development with local OAuth.

## Remote Mode

Server delegates to an upstream auth orchestrator for token management.

```typescript
auth: {
  mode: 'remote',
  provider: 'https://auth.example.com',
  clientId: 'my-client-id',
  clientSecret: process.env.AUTH_SECRET,
  tokenStorage: 'redis',
}
```

**Use when:** Enterprise deployments with centralized identity management.

## Comparison Table

| Feature          | Public        | Transparent     | Local       | Remote       |
| ---------------- | ------------- | --------------- | ----------- | ------------ |
| Token issuance   | Anonymous JWT | None (upstream) | Self-signed | Orchestrator |
| Token refresh    | No            | No              | Yes         | Yes          |
| PKCE support     | No            | No              | Yes         | Yes          |
| Credential vault | No            | No              | Yes         | Yes          |
| Consent flow     | No            | No              | Optional    | Optional     |
| Federated auth   | No            | No              | Optional    | Optional     |

## Examples

| Example                                                                                        | Level        | Description                                                                                 |
| ---------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------- |
| [`local-self-signed-tokens`](../examples/configure-auth-modes/local-self-signed-tokens.md)     | Intermediate | Configure a server that signs its own JWT tokens with consent and incremental auth enabled. |
| [`remote-enterprise-oauth`](../examples/configure-auth-modes/remote-enterprise-oauth.md)       | Advanced     | Delegate authentication to an external OAuth orchestrator with Redis-backed token storage.  |
| [`transparent-jwt-validation`](../examples/configure-auth-modes/transparent-jwt-validation.md) | Basic        | Validate externally-issued JWTs without managing token lifecycle on the server.             |

> See all examples in [`examples/configure-auth-modes/`](../examples/configure-auth-modes/)
