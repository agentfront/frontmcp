---
name: 14-tool-with-multiple-auth-providers
level: advanced
description: 'Tool with the full `authProviders` mapping form — one required provider with explicit scopes, one optional provider with an alias, and graceful degradation when the optional creds are missing.'
tags: [auth-providers, oauth, scopes, optional-auth, this.authProviders.headers]
features:
  - 'Using the object form of `authProviders` to set `required`, `scopes`, and `alias`'
  - Declaring required OAuth scopes that the server advertises in its Protected Resource Metadata (`scopes_supported`) so clients request them
  - "Resolving an optional provider via `await this.authProviders.headers('cloud')` (returns an empty object `{}` when absent)"
  - "Branching the tool's behavior — full deploy when both providers are present; preview-only when the cloud provider is missing"
  - "The required `github` provider gating the call: when its credential is missing the framework aborts before `execute()` with `-32001` and `data: { tool, providers: ['github'], authUrl }`; the optional `aws`/`cloud` provider never gates"
---

# Tool With Multiple Auth Providers

Tool with the full `authProviders` mapping form — one required provider with explicit scopes, one optional provider with an alias, and graceful degradation when the optional creds are missing.

The full form unlocks scopes, optional providers, and aliases. Use it when the simple shorthand isn't enough.

## Code

```typescript
// src/apps/main/tools/deploy-app.tool.ts
import { Tool, ToolContext, z } from '@frontmcp/sdk';

const inputSchema = {
  repo: z.string().regex(/^[^/]+\/[^/]+$/),
  environment: z.enum(['staging', 'production']),
  dryRun: z.boolean().default(false),
};
const outputSchema = {
  deploymentId: z.string(),
  url: z.string().url(),
  mode: z.enum(['preview', 'deployed']),
};

@Tool({
  name: 'deploy_app',
  description: 'Build and deploy a repo to cloud',
  inputSchema,
  outputSchema,
  authProviders: [
    { name: 'github', required: true, scopes: ['repo', 'workflow'] }, // required + scoped
    { name: 'aws', required: false, alias: 'cloud' }, // optional, aliased
  ],
  annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
})
export class DeployAppTool extends ToolContext {
  async execute(input: { repo: string; environment: 'staging' | 'production'; dryRun: boolean }) {
    const githubHeaders = await this.authProviders.headers('github');
    const cloudHeaders = await this.authProviders.headers('cloud'); // {} when AWS not connected
    const hasCloud = Object.keys(cloudHeaders).length > 0;

    // 1. Build artifact from the repo (always works — we have GitHub creds)
    const buildId = await this.triggerBuild(input.repo, githubHeaders);

    // 2. Deploy — only if cloud creds are present
    if (!hasCloud || input.dryRun) {
      return {
        deploymentId: `preview-${buildId}`,
        url: `https://preview.example.com/${buildId}`,
        mode: 'preview' as const,
      };
    }

    const deploymentId = await this.deployToCloud(buildId, input.environment, cloudHeaders);
    return {
      deploymentId,
      url: `https://${input.environment}.example.com/${deploymentId}`,
      mode: 'deployed' as const,
    };
  }

  private async triggerBuild(_repo: string, _headers: Record<string, string>): Promise<string> {
    return 'b_42';
  }
  private async deployToCloud(_buildId: string, _env: string, _headers: Record<string, string>): Promise<string> {
    return 'd_99';
  }
}
```

## What This Demonstrates

- Using the object form of `authProviders` to set `required`, `scopes`, and `alias`
- Declaring required OAuth scopes that the server advertises in its Protected Resource Metadata (`scopes_supported`) so clients request them
- Resolving an optional provider via `await this.authProviders.headers('cloud')` (returns an empty object `{}` when absent)
- Branching the tool's behavior — full deploy when both providers are present; preview-only when the cloud provider is missing
- The required `github` provider gating the call: when its credential is missing the framework aborts before `execute()` with `-32001` and `data: { tool, providers: ['github'], authUrl }`; the optional `aws`/`cloud` provider never gates

## Field reference (from auth-providers.md)

| Field      | Default  | Meaning                                                                                      |
| ---------- | -------- | -------------------------------------------------------------------------------------------- |
| `name`     | —        | Provider name — must match a registered credential provider                                  |
| `required` | `true`   | If `true`, the tool errors (`-32001`) before `execute()` runs when the credential is missing |
| `scopes`   | —        | OAuth scopes — advertised via PRM `scopes_supported` so clients know to request them         |
| `alias`    | = `name` | Local name for the provider — useful when two tools use the same provider differently        |

## When to use the object form

- Need scopes (`required: true, scopes: ['repo']`) — must use the object form
- Need optional providers (`required: false`) — must use the object form
- Need to alias the provider name (rare) — must use the object form
- Just one always-required provider with default scopes → the `authProviders: ['github']` shorthand is shorter
