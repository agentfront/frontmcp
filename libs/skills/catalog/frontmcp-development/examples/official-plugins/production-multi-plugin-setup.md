---
name: production-multi-plugin-setup
reference: official-plugins
level: advanced
description: 'Demonstrates a production-ready server configuration combining CodeCall, Remember, Approval, Cache, and Feature Flags plugins with Redis storage and external flag services.'
tags: [development, feature-flags, redis, keyword-search, cache, approval]
features:
  - 'Configuring all 5 stable official plugins together in a production server'
  - 'CodeCall in `codecall_only` mode with TF-IDF search and synonym expansion for semantic tool discovery'
  - 'Remember plugin with Redis storage, encryption enabled, and LLM-accessible memory tools'
  - 'Approval plugin in `webhook` mode with external PKCE-secured approval flow and audit logging'
  - 'Cache plugin with Redis storage and 24-hour default TTL'
  - 'Feature Flags with LaunchDarkly integration for external flag management'
  - 'Per-tool `approval` metadata with risk level and scope configuration'
  - 'Per-tool `featureFlag` with a `defaultValue` fallback if flag evaluation fails'
  - 'Using `this.approval.isApproved()` and `this.remember.set()` together in a single tool'
---

# Production Multi-Plugin Setup

Demonstrates a production-ready server configuration combining CodeCall, Remember, Approval, Cache, and Feature Flags plugins with Redis storage and external flag services.

## Code

```typescript
// src/server.ts
import { FrontMcp, App } from '@frontmcp/sdk';
import CodeCallPlugin from '@frontmcp/plugin-codecall';
import RememberPlugin from '@frontmcp/plugin-remember';
import { ApprovalPlugin } from '@frontmcp/plugin-approval';
import CachePlugin from '@frontmcp/plugin-cache';
import FeatureFlagPlugin from '@frontmcp/plugin-feature-flags';

@App({ name: 'core', tools: [ReadDataTool, WriteDataTool, DeleteDataTool] })
class CoreApp {}

@FrontMcp({
  info: { name: 'production-server', version: '1.0.0' },
  apps: [CoreApp],
  plugins: [
    CodeCallPlugin.init({
      mode: 'codecall_only',
      topK: 8,
      maxDefinitions: 8,
      vm: {
        preset: 'secure',
        timeoutMs: 5000,
        allowLoops: false,
      },
      embedding: {
        strategy: 'tfidf',
        synonymExpansion: { enabled: true },
      },
    }),

    RememberPlugin.init({
      type: 'redis',
      config: { host: process.env.REDIS_HOST!, port: 6379 },
      keyPrefix: 'remember:',
      encryption: { enabled: true },
      tools: { enabled: true },
    }),

    ApprovalPlugin.init({
      mode: 'webhook',
      webhook: {
        url: 'https://approval.example.com/webhook',
        challengeTtl: 300,
        callbackPath: '/approval/callback',
      },
      enableAudit: true,
      maxDelegationDepth: 3,
    }),

    CachePlugin.init({
      type: 'redis',
      config: { host: process.env.REDIS_HOST!, port: 6379 },
      defaultTTL: 86400,
    }),

    FeatureFlagPlugin.init({
      adapter: 'launchdarkly',
      config: { sdkKey: process.env.LD_SDK_KEY! },
    }),
  ],
})
class ProductionServer {}
```

```typescript
// src/tools/delete-data.tool.ts
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'delete_data',
  description: 'Permanently delete a data record',
  inputSchema: {
    recordId: z.string(),
    confirm: z.boolean(),
  },
  approval: {
    required: true,
    defaultScope: 'session',
    category: 'write',
    riskLevel: 'high',
    approvalMessage: 'Allow data deletion for this session?',
  },
  featureFlag: { key: 'enable-delete', defaultValue: false },
})
class DeleteDataTool extends ToolContext {
  async execute(input: { recordId: string; confirm: boolean }) {
    if (!input.confirm) {
      return { deleted: false, reason: 'Confirmation required' };
    }

    const isApproved = await this.approval.isApproved('delete_data');
    if (!isApproved) {
      return { deleted: false, reason: 'Awaiting approval' };
    }

    const db = this.get(DatabaseToken);
    await db.deleteRecord(input.recordId);

    await this.remember.set(`deleted:${input.recordId}`, new Date().toISOString());

    return { deleted: true, recordId: input.recordId };
  }
}
```

## What This Demonstrates

- Configuring all 5 stable official plugins together in a production server
- CodeCall in `codecall_only` mode with TF-IDF search and synonym expansion for semantic tool discovery
- Remember plugin with Redis storage, encryption enabled, and LLM-accessible memory tools
- Approval plugin in `webhook` mode with external PKCE-secured approval flow and audit logging
- Cache plugin with Redis storage and 24-hour default TTL
- Feature Flags with LaunchDarkly integration for external flag management
- Per-tool `approval` metadata with risk level and scope configuration
- Per-tool `featureFlag` with a `defaultValue` fallback if flag evaluation fails
- Using `this.approval.isApproved()` and `this.remember.set()` together in a single tool

## Related

- See `official-plugins` for all plugin options, storage types, and troubleshooting
- See `create-plugin-hooks` for adding custom lifecycle hooks alongside official plugins
