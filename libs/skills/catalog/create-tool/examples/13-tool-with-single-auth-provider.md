---
name: 13-tool-with-single-auth-provider
level: intermediate
description: "Tool requiring a single OAuth provider via the `authProviders: ['github']` string shorthand — credentials loaded before `execute()` runs."
tags: [auth-providers, oauth, github, this.authProviders, authProvidersVault]
features:
  - "Registering the `github` credential provider in `@FrontMcp({ authProvidersVault: { providers } })`, with the `factory` that acquires each caller's token"
  - "Declaring a single required OAuth provider with the `authProviders: ['github']` shorthand"
  - "Reading pre-formatted credentials via `await this.authProviders.headers('github')`"
  - "Letting the framework reject calls whose required credential is missing **before** `execute()` runs — a JSON-RPC `-32001` (MCP `UNAUTHORIZED`) error whose `data` carries `{ tool, providers: ['github'] }` (no auth-check boilerplate)"
---

# Tool With Single Auth Provider

Tool requiring a single OAuth provider via the `authProviders: ['github']` string shorthand — credentials loaded before `execute()` runs.

The shorthand form. The server registers the `github` provider in `authProvidersVault`; by the time `execute()` runs, the framework has called its `factory` for the caller, and `this.authProviders.headers('github')` returns `{ Authorization: 'Bearer …' }` ready to forward.

## Code

```typescript
// src/server.ts
import { FrontMcp } from '@frontmcp/sdk';

import { MainApp } from './apps/main';
import { githubTokenOf } from './github-tokens'; // your store of each user's GitHub token

@FrontMcp({
  info: { name: 'github-tools', version: '1.0.0' },
  apps: [MainApp],
  authProvidersVault: {
    providers: [
      {
        name: 'github',
        scope: 'user', // one credential per signed-in user; 'global' shares one, 'session' keeps one per session
        loading: 'lazy',
        factory: async ({ userSub }) => {
          const token = userSub ? await githubTokenOf(userSub) : undefined;
          return token ? { type: 'bearer', token } : null; // null: not connected, so the call gets -32001
        },
      },
    ],
  },
})
export default class Server {}
```

```typescript
// src/apps/main/tools/list-repos.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

const inputSchema = {
  visibility: z.enum(['all', 'public', 'private']).default('all'),
  perPage: z.number().int().min(1).max(100).default(30),
};
const outputSchema = {
  repos: z.array(z.object({ fullName: z.string(), stars: z.number().int(), private: z.boolean() })),
};

@Tool({
  name: 'list_repos',
  description: 'List GitHub repos the authenticated user has access to',
  inputSchema,
  outputSchema,
  authProviders: ['github'], // shorthand — single, required provider
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
})
export class ListReposTool extends ToolContext {
  async execute(input: { visibility: 'all' | 'public' | 'private'; perPage: number }) {
    const headers = await this.authProviders.headers('github');

    const url = new URL('https://api.github.com/user/repos');
    url.searchParams.set('visibility', input.visibility);
    url.searchParams.set('per_page', String(input.perPage));

    const response = await this.fetch(url, { headers });
    const data = (await response.json()) as Array<{ full_name: string; stargazers_count: number; private: boolean }>;

    return {
      repos: data.map((r) => ({
        fullName: r.full_name,
        stars: r.stargazers_count,
        private: r.private,
      })),
    };
  }
}
```

## What This Demonstrates

- Registering the `github` credential provider in `@FrontMcp({ authProvidersVault: { providers } })`, with the `factory` that acquires each caller's token
- Declaring a single required OAuth provider with the `authProviders: ['github']` shorthand
- Reading pre-formatted credentials via `await this.authProviders.headers('github')`
- Letting the framework reject calls whose required credential is missing **before** `execute()` runs — a JSON-RPC `-32001` (MCP `UNAUTHORIZED`) error whose `data` carries `{ tool, providers: ['github'] }` (no auth-check boilerplate)

The factory gets the caller's `userSub`, `userEmail`, `userName` and `sessionId`. Its credential is cached for the
request, and for the requests of a verified session on a single-instance server; nothing is stored between them.
Add a `refresh` function to the provider for `this.authProviders.refresh('github')`. On a server without `authProvidersVault`, `this.authProviders.get('github')`
throws `AuthProvidersNotConfiguredError` naming `github`.

The `authUrl` in the `-32001` data comes from the session credential vault (`this.credentials`, local mode): when a
`github` credential the caller connected at sign-in is missing, the error carries the connect URL. See
`15-tool-with-credential-vault`.

## What you don't have to write

```typescript
// ❌ unnecessary — the framework already did all of this before execute() ran:
const cred = await this.authProviders.get('github');
if (!cred) {
  this.fail(new PublicMcpError('No GitHub auth — please sign in', { authUrl: '…' }));
}
const accessToken = cred.credential.accessToken;
if (cred.expiresAt && Date.now() >= cred.expiresAt) {
  /* refresh */
}
const headers = { Authorization: `Bearer ${accessToken}` };
```

The single line `await this.authProviders.headers('github')` covers it all.
