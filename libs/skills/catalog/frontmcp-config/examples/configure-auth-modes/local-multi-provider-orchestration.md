---
name: local-multi-provider-orchestration
reference: configure-auth-modes
level: advanced
description: 'Orchestrate multiple upstream OAuth providers (GitHub + Slack) in local mode, gate the JWT until they are linked, and read downstream tokens in tools via this.orchestration.'
tags: [config, auth, local, orchestration, federated, providers, multi-provider, auth-modes]
features:
  - 'Declaring an `auth.providers` array so FrontMCP federates GitHub + Slack at /oauth/authorize and stores their tokens encrypted server-side'
  - 'Using `authorizeUrl`/`tokenUrl` aliases and letting the per-provider callback URL be auto-computed as ${issuer}/oauth/provider/${id}/callback'
  - 'Gating JWT issuance with `federatedAuth.minProviders` / `requiredProviders` so no token is minted until the linked-provider threshold is met'
  - 'Reading downstream provider tokens in a tool via `this.orchestration.getToken(id)` / `tryGetToken(id)` without exposing them to the LLM'
---

# Multi-Provider Orchestration (Local Mode)

Orchestrate multiple upstream OAuth providers (GitHub + Slack) in local mode, gate the JWT until they are linked, and read downstream tokens in tools via this.orchestration.

## Code

```typescript
// src/server.ts
// JWT_SECRET signs the HS256 tokens — set a stable value.
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'github_repos',
  description: 'List the operator GitHub repositories using the linked upstream token',
  inputSchema: {},
  outputSchema: { repos: z.array(z.string()) },
})
class GitHubReposTool extends ToolContext {
  async execute() {
    // `this.orchestration` is bound for authenticated orchestrated requests.
    const token = await this.orchestration.getToken('github'); // throws if not linked
    const res = await fetch('https://api.github.com/user/repos', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const repos = (await res.json()) as Array<{ full_name: string }>;
    return { repos: repos.map((r) => r.full_name) };
  }
}

@App({
  name: 'orchestrated-api',
  auth: {
    mode: 'local',
    // Declare the upstream providers to orchestrate. `authorizeUrl`/`tokenUrl`
    // are accepted aliases for `authorizationEndpoint`/`tokenEndpoint`.
    providers: [
      {
        id: 'github',
        authorizeUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        clientId: process.env.GITHUB_CLIENT_ID!,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        scopes: ['read:user', 'repo'],
      },
      {
        id: 'slack',
        authorizeUrl: 'https://slack.com/oauth/v2/authorize',
        tokenUrl: 'https://slack.com/api/oauth.v2.access',
        clientId: process.env.SLACK_CLIENT_ID!,
        clientSecret: process.env.SLACK_CLIENT_SECRET,
        scopes: ['users:read'],
      },
    ],
    // No JWT is minted until GitHub (required) is linked.
    federatedAuth: { minProviders: 1, requiredProviders: ['github'] },
    tokenStorage: { sqlite: { path: './data/auth.sqlite' } },
  },
  tools: [GitHubReposTool],
})
class OrchestratedApi {}

@FrontMcp({
  info: { name: 'orchestrated-server', version: '1.0.0' },
  apps: [OrchestratedApi],
})
class Server {}
```

## What This Demonstrates

- Declaring an `auth.providers` array so FrontMCP federates GitHub + Slack at /oauth/authorize and stores their tokens encrypted server-side
- Using `authorizeUrl`/`tokenUrl` aliases and letting the per-provider callback URL be auto-computed as ${issuer}/oauth/provider/${id}/callback
- Gating JWT issuance with `federatedAuth.minProviders` / `requiredProviders` so no token is minted until the linked-provider threshold is met
- Reading downstream provider tokens in a tool via `this.orchestration.getToken(id)` / `tryGetToken(id)` without exposing them to the LLM

## Related

- See `configure-auth` → "Multi-provider orchestration" for the full provider schema and the `this.orchestration` API
- See `configure-auth-modes` for a comparison of all auth modes
- See `local-single-operator` for the no-provider single-operator local setup
