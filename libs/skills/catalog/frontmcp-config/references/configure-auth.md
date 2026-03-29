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

Local mode lets the FrontMCP server sign its own JWT tokens. This is useful for internal services or environments where an external identity provider is not available.

```typescript
@App({
  auth: {
    mode: 'local',
    local: {
      issuer: 'my-server',
    },
  },
})
class MyApp {}
```

- `local.issuer` -- the `iss` claim set in generated tokens (defaults to server URL if omitted).

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

The credential vault stores downstream API tokens obtained during the OAuth flow. Use it when your MCP tools need to call external APIs on behalf of the authenticated user. Credential vault is managed through the auth provider's OAuth flow — downstream tokens are stored automatically when users authorize external services.

```typescript
@App({
  name: 'MyApp',
  auth: {
    mode: 'remote',
    provider: 'https://auth.example.com',
    clientId: 'mcp-client-id',
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

## Common Patterns

| Pattern                     | Correct                                                                        | Incorrect                                                       | Why                                                                           |
| --------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Session store in production | Use Redis or Vercel KV session store                                           | Use default in-memory session store                             | Sessions are lost on restart; in-memory does not survive process recycling    |
| Secret management           | Load `clientId`, vault secrets, and Redis passwords from environment variables | Hardcode secrets in source code                                 | Hardcoded secrets leak into version control and are difficult to rotate       |
| Audience validation         | Always set `expectedAudience` in transparent/remote mode                       | Omit the audience field                                         | Without audience validation, tokens issued for any audience would be accepted |
| Auth mode for development   | Use `public` mode or local OAuth mock for dev environments                     | Use `remote` mode pointing at production IdP during development | Avoids accidental production token usage and simplifies local iteration       |
| Vault encryption secret     | Generate a strong random secret and store in env var `VAULT_SECRET`            | Use a short or predictable string for vault encryption          | Weak secrets compromise all stored downstream credentials                     |

## Verification Checklist

**Configuration**

- [ ] Auth mode is set to the correct value for the deployment target (`public`, `transparent`, `local`, or `remote`)
- [ ] `provider` URL is set when using `transparent` or `remote` mode
- [ ] `clientId` is configured when using `remote` mode
- [ ] `expectedAudience` is set when using `transparent` mode

**Security**

- [ ] No secrets are hardcoded in source files -- all loaded from environment variables
- [ ] Vault encryption secret is a strong random value
- [ ] Production deployments use Redis or Vercel KV for session storage, not in-memory

**Runtime**

- [ ] Server starts without auth-related errors in the console
- [ ] Tokens are validated correctly (test with a valid and an invalid token)
- [ ] Downstream credential vault returns tokens for configured providers
- [ ] Multi-app configurations route requests to the correct auth mode per app

## Troubleshooting

| Problem                                 | Cause                                                                        | Solution                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `JWKS fetch failed` error on startup    | The `provider` URL is unreachable or does not serve `/.well-known/jwks.json` | Verify the provider URL is correct and accessible from the server; check network/firewall rules   |
| Tokens rejected with `invalid audience` | The `expectedAudience` value does not match the `aud` claim in the token     | Align the `expectedAudience` config with the audience value your identity provider sets in tokens |
| Sessions lost after server restart      | Using the default in-memory session store in production                      | Switch to Redis or Vercel KV session store via `configure-session` reference                      |
| `VAULT_SECRET is not defined` error     | The vault encryption secret environment variable is missing                  | Set `VAULT_SECRET` in your environment or `.env` file before starting the server                  |
| OAuth redirect fails in local dev       | `remote` mode requires HTTPS and reachable callback URLs                     | Set `NODE_ENV=development` to relax HTTPS requirements, or use a local OAuth mock server          |

## Reference

- Docs: [Authentication Overview](https://docs.agentfront.dev/frontmcp/authentication/overview)
- Related skills: `configure-session`, `create-plugin`
