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
