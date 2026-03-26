---
name: deploy-to-vercel
description: Deploy a FrontMCP server to Vercel serverless functions. Use when deploying to Vercel, configuring Vercel KV, or setting up serverless MCP.
tags:
  - deployment
  - vercel
  - serverless
  - edge
parameters:
  - name: region
    description: Vercel deployment region
    type: string
    required: false
    default: iad1
  - name: kv-store
    description: Name of the Vercel KV store to use for session and skill storage
    type: string
    required: false
examples:
  - scenario: Deploy to Vercel with Vercel KV
    parameters:
      kv-store: frontmcp-kv
    expected-outcome: A FrontMCP server running as Vercel serverless functions with Vercel KV providing persistent storage for sessions and skill state.
  - scenario: Deploy with custom domain
    parameters:
      region: cdg1
    expected-outcome: A FrontMCP server accessible via a custom domain with automatic TLS, deployed to the Paris region.
compatibility: Vercel CLI required
license: Apache-2.0
visibility: both
priority: 10
metadata:
  category: deployment
  difficulty: intermediate
  platform: vercel
  docs: https://docs.agentfront.dev/frontmcp/deployment/serverless
---

# Deploy a FrontMCP Server to Vercel

This skill guides you through deploying a FrontMCP server to Vercel serverless functions with Vercel KV for persistent storage.

## Prerequisites

- A Vercel account (https://vercel.com)
- Vercel CLI installed: `npm install -g vercel`
- A built FrontMCP project

## Step 1: Build for Vercel

```bash
frontmcp build --target vercel
```

This produces a Vercel-compatible output structure with an `api/` directory containing the serverless function entry points, optimized bundles for cold-start performance, and a `vercel.json` configuration file.

## Step 2: Configure vercel.json

Create or update `vercel.json` in your project root:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/api/frontmcp" }],
  "functions": {
    "api/frontmcp.ts": {
      "memory": 1024,
      "maxDuration": 60
    }
  },
  "regions": ["iad1"],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" }
      ]
    }
  ]
}
```

The rewrite rule sends all requests to the single FrontMCP API handler, which internally routes MCP and HTTP requests.

## Step 3: Configure Vercel KV Storage

Use the `vercel-kv` provider so FrontMCP stores sessions, skill cache, and plugin state in Vercel KV (powered by Upstash Redis):

```typescript
import { FrontMcp, App } from '@frontmcp/sdk';

@App()
class MyApp {}

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  redis: { provider: 'vercel-kv' },
  skillsConfig: {
    enabled: true,
    cache: {
      enabled: true,
      redis: { provider: 'vercel-kv' },
      ttlMs: 60000,
    },
  },
})
class MyServer {}
```

Provision the KV store in the Vercel dashboard under **Storage > Create Database > KV (Redis)**, then link it to your project. Vercel automatically injects the required environment variables.

## Step 4: Environment Variables

Vercel KV variables are injected automatically when the store is linked. For manual setup or additional configuration, set them in the Vercel dashboard (**Settings > Environment Variables**) or via the CLI:

```bash
vercel env add KV_REST_API_URL "https://your-kv-store.kv.vercel-storage.com"
vercel env add KV_REST_API_TOKEN "your-token"
vercel env add NODE_ENV production
vercel env add LOG_LEVEL info
```

| Variable            | Description                    | Required    |
| ------------------- | ------------------------------ | ----------- |
| `KV_REST_API_URL`   | Vercel KV REST endpoint        | If using KV |
| `KV_REST_API_TOKEN` | Vercel KV authentication token | If using KV |
| `NODE_ENV`          | Runtime environment            | Yes         |
| `LOG_LEVEL`         | Logging verbosity              | No          |

## Step 5: Deploy

### Preview Deployment

```bash
vercel
```

Creates a preview deployment with a unique URL for validation.

### Production Deployment

```bash
vercel --prod
```

Deploys to your production domain.

### Custom Domain

```bash
vercel domains add mcp.example.com
```

Configure your DNS provider to point the domain to Vercel. TLS certificates are provisioned automatically.

## Step 6: Verify

```bash
# Health check
curl https://your-project.vercel.app/health

# Test MCP endpoint
curl -X POST https://your-project.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## Cold Start Notes

Vercel serverless functions experience cold starts after periods of inactivity. To minimize impact:

- The `frontmcp build --target vercel` output is optimized for bundle size. Avoid adding unnecessary dependencies.
- Consider Vercel's **Fluid Compute** for latency-sensitive workloads.
- Keep function memory at 1024 MB for faster initialization.

### Execution Limits

| Plan       | Max Duration |
| ---------- | ------------ |
| Hobby      | 10 seconds   |
| Pro        | 60 seconds   |
| Enterprise | 900 seconds  |

Long-running MCP operations should complete within these limits or use streaming responses.

### Statelessness

Serverless functions are stateless between invocations. All persistent state must go through Vercel KV. FrontMCP handles this automatically when `{ provider: 'vercel-kv' }` is configured.

## Troubleshooting

- **Function timeout**: Increase `maxDuration` in `vercel.json` or optimize the operation. Check your Vercel plan limits.
- **KV connection errors**: Verify the KV store is linked and environment variables are set. Re-link the store in the dashboard if needed.
- **404 on API routes**: Confirm the rewrite rule in `vercel.json` routes traffic to `/api/frontmcp`.
- **Bundle too large**: Run `frontmcp build --target vercel --analyze` to inspect the bundle.
