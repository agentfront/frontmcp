---
name: distributed-elicitation-redis
reference: configure-elicitation
level: intermediate
description: 'Configure elicitation with Redis storage for multi-instance production deployments.'
tags: [config, redis, elicitation, distributed]
features:
  - 'Configuring Redis-backed elicitation state for multi-instance deployments'
  - 'Using a `requestedSchema` with both required and optional fields'
  - 'Elicitation state is shared across server instances so the response can arrive at any replica'
  - 'Loading Redis connection details from environment variables'
---

# Distributed Elicitation with Redis

Configure elicitation with Redis storage for multi-instance production deployments.

## Code

```typescript
// src/server.ts
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({
  name: 'deploy_service',
  description: 'Deploy a service to production',
  inputSchema: {
    service: z.string(),
    version: z.string(),
  },
  outputSchema: { deploymentId: z.string(), status: z.string() },
})
class DeployServiceTool extends ToolContext {
  async execute(input: { service: string; version: string }) {
    const confirmation = await this.elicit({
      message: `Deploy ${input.service}@${input.version} to production?`,
      requestedSchema: {
        type: 'object',
        properties: {
          confirmed: { type: 'boolean', description: 'Confirm deployment' },
          reason: { type: 'string', description: 'Deployment reason (optional)' },
        },
        required: ['confirmed'],
      },
    });

    if (!confirmation || !confirmation.confirmed) {
      return { deploymentId: '', status: 'cancelled' };
    }

    return { deploymentId: 'deploy-abc123', status: 'started' };
  }
}

@App({
  name: 'deploy-tools',
  tools: [DeployServiceTool],
})
class DeployApp {}

@FrontMcp({
  info: { name: 'deploy-server', version: '1.0.0' },
  apps: [DeployApp],
  elicitation: {
    enabled: true,
    redis: {
      provider: 'redis',
      host: process.env['REDIS_HOST'] ?? 'localhost',
      port: Number(process.env['REDIS_PORT'] ?? 6379),
    },
  },
})
class Server {}
```

## What This Demonstrates

- Configuring Redis-backed elicitation state for multi-instance deployments
- Using a `requestedSchema` with both required and optional fields
- Elicitation state is shared across server instances so the response can arrive at any replica
- Loading Redis connection details from environment variables

## Related

- See `configure-elicitation` for the full elicitation configuration reference
- See `configure-session` for session storage with Redis
