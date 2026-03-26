---
name: configure-auth
description: Set up authentication with public, transparent, local, or remote auth modes. Use when adding auth, OAuth, login, session security, or protecting tools and resources.
tags:
  - auth
  - oauth
  - security
bundle:
  - recommended
  - full
visibility: both
priority: 10
parameters:
  - name: mode
    description: Authentication mode (public, transparent, local, remote)
    type: string
    required: false
    default: public
  - name: provider
    description: OAuth provider URL for transparent or remote modes
    type: string
    required: false
examples:
  - scenario: Public mode with anonymous scopes
    parameters:
      mode: public
    expected-outcome: Server accepts all connections with anonymous scopes and session TTL
  - scenario: Transparent mode validating external JWTs
    parameters:
      mode: transparent
      provider: https://auth.example.com
    expected-outcome: Server validates JWTs from the configured provider against the expected audience
  - scenario: Local mode with server-signed tokens
    parameters:
      mode: local
    expected-outcome: Server signs its own JWT tokens for client authentication
  - scenario: Remote mode with full OAuth flow
    parameters:
      mode: remote
      provider: https://auth.example.com
    expected-outcome: Server redirects clients through a remote OAuth authorization flow
license: Apache-2.0
compatibility: Requires Node.js 18+ and @frontmcp/auth package
metadata:
  category: auth
  difficulty: intermediate
  docs: https://docs.agentfront.dev/frontmcp/authentication/overview
---

# Configure Authentication for FrontMCP

This skill covers setting up authentication in a FrontMCP server. FrontMCP supports four auth modes, each suited to different deployment scenarios. All authentication logic lives in the `@frontmcp/auth` library.

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

Local mode lets the FrontMCP server sign its own JWT tokens. This is useful for internal services or environments where an external identity provider is not available.

```typescript
@App({
  auth: {
    mode: 'local',
    local: {
      issuer: 'my-server',
      audience: 'my-api',
    },
  },
})
class MyApp {}
```

- `local.issuer` -- the `iss` claim set in generated tokens.
- `local.audience` -- the `aud` claim set in generated tokens.

The server generates a signing key pair on startup (or loads one from the configured key store). Clients obtain tokens through a server-provided endpoint.

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

## Credential Vault

The credential vault stores downstream API tokens obtained during the OAuth flow. Use it when your MCP tools need to call external APIs on behalf of the authenticated user:

```typescript
@App({
  auth: {
    mode: 'remote',
    provider: 'https://auth.example.com',
    clientId: 'mcp-client-id',
  },
  vault: {
    encryption: {
      secret: process.env['VAULT_SECRET'],
    },
    providers: [
      {
        name: 'github',
        type: 'oauth2',
        scopes: ['repo', 'read:user'],
      },
      {
        name: 'slack',
        type: 'oauth2',
        scopes: ['chat:write', 'channels:read'],
      },
    ],
  },
})
class MyApp {}
```

Tools access downstream credentials via the `this.authProviders` context extension:

```typescript
@Tool({ name: 'create_github_issue' })
class CreateGithubIssueTool extends ToolContext {
  async execute(input: { title: string; body: string }) {
    // Access downstream credentials via the authProviders context extension
    const github = await this.authProviders.get('github');
    const headers = await this.authProviders.headers('github');
    // Use headers to call GitHub API
  }
}
```

The `authProviders` accessor (from `@frontmcp/auth`) provides:

- `get(provider)` -- get the credential/token for a provider.
- `headers(provider)` -- get pre-formatted auth headers for HTTP requests.
- `has(provider)` -- check if a provider is configured.
- `refresh(provider)` -- force refresh the credential.

## Common Mistakes

- **Using memory session store in production** -- sessions are lost on restart. Use Redis or Vercel KV.
- **Hardcoding secrets** -- use environment variables for `clientId`, vault secrets, and Redis passwords.
- **Missing audience validation** -- always set the audience field. Without it, tokens from any audience would be accepted.

## Reference

- Auth docs: [docs.agentfront.dev/frontmcp/authentication/overview](https://docs.agentfront.dev/frontmcp/authentication/overview)
- Auth package: `@frontmcp/auth` — [source](https://github.com/agentfront/frontmcp/tree/main/libs/auth)
- Auth options interface: import `AuthOptionsInput` from `@frontmcp/auth` — [source](https://github.com/agentfront/frontmcp/tree/main/libs/auth/src/options)
- Credential vault: import from `@frontmcp/auth` — [source](https://github.com/agentfront/frontmcp/tree/main/libs/auth/src/vault)
