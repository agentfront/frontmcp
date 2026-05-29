---
name: 14-tool-with-multiple-auth-providers
level: advanced
description: 'Tool with the full `authProviders` mapping form — one required provider with explicit scopes, one optional provider with an alias, and graceful degradation when the optional creds are missing.'
tags: [auth-providers, oauth, scopes, optional-auth, this.authProviders.tryHeaders]
features:
  - 'Using the object form of `authProviders` to set `required`, `scopes`, and `alias`'
  - Requesting specific OAuth scopes so the framework triggers incremental auth when missing
  - "Resolving an optional provider via `await this.authProviders.tryHeaders('cloud')` (returns `null` when absent)"
  - "Branching the tool's behavior — full deploy when both providers are present; preview-only when the cloud provider is missing"
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
    const cloudHeaders = await this.authProviders.tryHeaders('cloud'); // null when AWS not connected

    // 1. Build artifact from the repo (always works — we have GitHub creds)
    const buildId = await this.triggerBuild(input.repo, githubHeaders);

    // 2. Deploy — only if cloud creds are present
    if (!cloudHeaders || input.dryRun) {
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

  private async triggerBuild(_repo: string, _headers: Headers): Promise<string> {
    return 'b_42';
  }
  private async deployToCloud(_buildId: string, _env: string, _headers: Headers): Promise<string> {
    return 'd_99';
  }
}
```

## What This Demonstrates

- Using the object form of `authProviders` to set `required`, `scopes`, and `alias`
- Requesting specific OAuth scopes so the framework triggers incremental auth when missing
- Resolving an optional provider via `await this.authProviders.tryHeaders('cloud')` (returns `null` when absent)
- Branching the tool's behavior — full deploy when both providers are present; preview-only when the cloud provider is missing

## Field reference (from auth-providers.md)

| Field      | Default  | Meaning                                                                               |
| ---------- | -------- | ------------------------------------------------------------------------------------- |
| `name`     | —        | Provider name — must match a registered `@AuthProvider`                               |
| `required` | `true`   | If `true`, the tool errors before `execute()` runs when creds are missing             |
| `scopes`   | —        | OAuth scopes — triggers incremental auth if the session lacks them                    |
| `alias`    | = `name` | Local name for the provider — useful when two tools use the same provider differently |

## When to use the object form

- Need scopes (`required: true, scopes: ['repo']`) — must use the object form
- Need optional providers (`required: false`) — must use the object form
- Need to alias the provider name (rare) — must use the object form
- Just one always-required provider with default scopes → the `authProviders: ['github']` shorthand is shorter
