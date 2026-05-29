---
name: 13-tool-with-single-auth-provider
level: intermediate
description: "Tool requiring a single OAuth provider via the `authProviders: ['github']` string shorthand — credentials loaded before `execute()` runs."
tags: [auth-providers, oauth, github, this.authProviders]
features:
  - "Declaring a single required OAuth provider with the `authProviders: ['github']` shorthand"
  - "Reading pre-formatted credentials via `await this.authProviders.headers('github')`"
  - 'Letting the framework reject unauthenticated calls before `execute()` runs (no auth-check boilerplate)'
  - 'Trusting the framework to handle token refresh, expiration, and the OAuth start URL'
---

# Tool With Single Auth Provider

Tool requiring a single OAuth provider via the `authProviders: ['github']` string shorthand — credentials loaded before `execute()` runs.

The shorthand form. By the time `execute()` runs, the user has completed the OAuth flow and credentials are in the vault — `this.authProviders.headers('github')` returns `{ Authorization: 'Bearer …' }` ready to forward.

## Code

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

- Declaring a single required OAuth provider with the `authProviders: ['github']` shorthand
- Reading pre-formatted credentials via `await this.authProviders.headers('github')`
- Letting the framework reject unauthenticated calls before `execute()` runs (no auth-check boilerplate)
- Trusting the framework to handle token refresh, expiration, and the OAuth start URL

## What you don't have to write

```typescript
// ❌ unnecessary — the framework already did all of this before execute() ran:
if (!this.context.authInfo.tokens?.github) {
  this.fail(new PublicMcpError('No GitHub auth — please sign in', { authUrl: '…' }));
}
const accessToken = this.context.authInfo.tokens.github;
if (Date.now() >= accessToken.expiresAt) {
  /* refresh */
}
const headers = { Authorization: `Bearer ${accessToken.value}` };
```

The single line `await this.authProviders.headers('github')` covers it all.
