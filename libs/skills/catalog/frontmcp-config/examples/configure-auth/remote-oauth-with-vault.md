---
name: remote-oauth-with-vault
reference: configure-auth
level: intermediate
description: 'Configure a FrontMCP server with local OAuth orchestration of an upstream provider and read the downstream provider token in a tool via this.orchestration.getToken.'
tags: [config, oauth, auth, orchestration, providers]
features:
  - 'Declaring an upstream provider in top-level `auth.providers` so FrontMCP orchestrates its OAuth flow'
  - 'Loading `clientId`/`clientSecret` from environment variables instead of hardcoding'
  - "Reading the downstream provider token in a tool via `this.orchestration.getToken('github')`"
---

# Local OAuth Orchestration with a Downstream Provider Token

Configure a FrontMCP server with local OAuth orchestration of an upstream provider and read the downstream provider token in a tool via this.orchestration.getToken.

> **Two distinct subsystems — do not conflate them.** `this.orchestration` reads
> tokens for providers declared in top-level `auth.providers` (the local-mode
> multi-provider OAuth orchestrator). `this.authProviders` is a _separate_
> downstream-OAuth-provider accessor whose providers are registered via
> `@App`/`@Tool({ authProviders: [...] })`. Neither is the per-session credential
> vault — that is `this.credentials` (see `local-credential-vault`). This example
> uses the orchestrator, so the provider MUST be declared in `auth.providers` or
> `getToken('github')` has nothing to return.

## Code

```typescript
// src/server.ts
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'create_github_issue',
  description: 'Create a GitHub issue on behalf of the user',
  inputSchema: {
    repo: z.string(),
    title: z.string(),
    body: z.string(),
  },
  outputSchema: { issueUrl: z.string() },
})
class CreateGithubIssueTool extends ToolContext {
  async execute(input: { repo: string; title: string; body: string }) {
    // Read the orchestrated GitHub token (declared in auth.providers below).
    // Throws if GitHub is not linked for this session; use tryGetToken() for a
    // null-on-missing variant. The raw token is never exposed to the LLM.
    const token = await this.orchestration.getToken('github');

    const response = await fetch(`https://api.github.com/repos/${input.repo}/issues`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: input.title, body: input.body }),
    });
    const issue = await response.json();
    return { issueUrl: issue.html_url };
  }
}

@App({ name: 'dev-tools', tools: [CreateGithubIssueTool] })
class DevToolsApp {}

@FrontMcp({
  info: { name: 'dev-tools-server', version: '1.0.0' },
  apps: [DevToolsApp],
  // Server-level auth so it applies to every app (no `splitByApp` needed).
  auth: {
    mode: 'local',
    // Declare the upstream provider FrontMCP should orchestrate. FrontMCP
    // federates it at /oauth/authorize, stores its tokens encrypted
    // server-side, and exposes them via this.orchestration.getToken('github').
    providers: [
      {
        id: 'github',
        authorizeUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        clientId: process.env['GITHUB_CLIENT_ID']!,
        clientSecret: process.env['GITHUB_CLIENT_SECRET'],
        scopes: ['repo'],
      },
    ],
    federatedAuth: { minProviders: 1, requiredProviders: ['github'] },
  },
})
class Server {}
```

## What This Demonstrates

- Declaring an upstream provider in top-level `auth.providers` so FrontMCP orchestrates its OAuth flow
- Loading `clientId`/`clientSecret` from environment variables instead of hardcoding
- Reading the downstream provider token in a tool via `this.orchestration.getToken('github')`

## Related

- See `configure-auth` for the multi-provider orchestration config and the `this.orchestration` API (`getToken`, `tryGetToken`, `isAuthenticated`)
- See `local-credential-vault` for the separate per-session vault (`this.credentials`)
- See `configure-session` for setting up Redis-based session storage in production
