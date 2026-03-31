---
name: remote-oauth-with-vault
reference: configure-auth
level: intermediate
description: 'Configure a FrontMCP server with remote OAuth 2.1 authentication and use the credential vault to call downstream APIs on behalf of the authenticated user.'
tags: [config, oauth, auth, remote, vault]
features:
  - "Configuring `mode: 'remote'` for full OAuth 2.1 authorization flow"
  - 'Loading `clientId` from environment variables instead of hardcoding'
  - "Using `this.authProviders.headers('github')` to get pre-formatted auth headers for downstream API calls"
---

# Remote OAuth Mode with Credential Vault

Configure a FrontMCP server with remote OAuth 2.1 authentication and use the credential vault to call downstream APIs on behalf of the authenticated user.

## Code

```typescript
// src/server.ts
import { FrontMcp, App, Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

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
    // Access downstream credentials via the authProviders context extension
    const headers = await this.authProviders.headers('github');

    const response = await fetch(`https://api.github.com/repos/${input.repo}/issues`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: input.title, body: input.body }),
    });
    const issue = await response.json();
    return { issueUrl: issue.html_url };
  }
}

@App({
  name: 'dev-tools',
  auth: {
    mode: 'remote',
    provider: 'https://auth.example.com',
    clientId: process.env['OAUTH_CLIENT_ID'] ?? 'mcp-client-id',
  },
  tools: [CreateGithubIssueTool],
})
class DevToolsApp {}

@FrontMcp({
  info: { name: 'dev-tools-server', version: '1.0.0' },
  apps: [DevToolsApp],
})
class Server {}
```

## What This Demonstrates

- Configuring `mode: 'remote'` for full OAuth 2.1 authorization flow
- Loading `clientId` from environment variables instead of hardcoding
- Using `this.authProviders.headers('github')` to get pre-formatted auth headers for downstream API calls

## Related

- See `configure-auth` for credential vault API (`get`, `headers`, `has`, `refresh`)
- See `configure-session` for setting up Redis-based session storage in production
