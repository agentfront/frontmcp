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

## When to Use This Skill

### Must Use

- Deploying a FrontMCP server to Vercel serverless functions
- Configuring Vercel KV as the persistence layer for sessions and skill cache
- Setting up a serverless MCP endpoint with automatic TLS and global CDN

### Recommended

- You already use Vercel for your frontend and want a unified deployment pipeline
- You need zero-ops scaling without managing Docker containers or servers
- Deploying preview environments per pull request for MCP server testing

### Skip When

- You need persistent connections, WebSockets, or long-running processes -- use `deploy-to-node` instead
- Deploying to AWS infrastructure or need AWS-specific services -- use `deploy-to-lambda` instead
- Your MCP operations routinely exceed the Vercel function timeout for your plan

> **Decision:** Choose this skill when you want serverless deployment on Vercel with minimal infrastructure management; choose a different target when you need persistent processes or AWS-native services.

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

## Common Patterns

| Pattern               | Correct                                    | Incorrect                            | Why                                                                             |
| --------------------- | ------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------- |
| Build command         | `frontmcp build --target vercel`           | `tsc` or generic `npm run build`     | The Vercel target produces optimized bundles and the `api/` directory structure |
| KV provider config    | `{ provider: 'vercel-kv' }`                | `{ provider: 'redis', host: '...' }` | Vercel KV uses its own REST API; a raw Redis provider will not connect          |
| Rewrite rule          | `"source": "/(.*)"` to `/api/frontmcp`     | No rewrite or per-route entries      | A single catch-all rewrite lets FrontMCP's internal router handle all paths     |
| Environment variables | Link KV store in dashboard (auto-injected) | Hardcode `KV_REST_API_URL` in source | Linked stores inject vars automatically and rotate tokens safely                |
| Function memory       | 1024 MB for faster cold starts             | 128 MB default                       | CPU scales with memory on Vercel; higher memory reduces initialization time     |

## Verification Checklist

**Build**

- [ ] `frontmcp build --target vercel` completes without errors
- [ ] `api/frontmcp.ts` (or `.js`) exists in the build output

**Deployment**

- [ ] `vercel` creates a preview deployment without errors
- [ ] `vercel --prod` deploys to the production domain
- [ ] `curl https://your-project.vercel.app/health` returns `{"status":"ok"}`

**Storage and Configuration**

- [ ] Vercel KV store is created and linked to the project
- [ ] `KV_REST_API_URL` and `KV_REST_API_TOKEN` are present in environment variables
- [ ] `NODE_ENV` is set to `production`
- [ ] `vercel.json` has correct rewrite, function config, and region settings

**Production Readiness**

- [ ] Custom domain is configured with DNS pointing to Vercel
- [ ] TLS certificate is provisioned (automatic on Vercel)
- [ ] `maxDuration` in `vercel.json` matches your Vercel plan limits

## Troubleshooting

| Problem              | Cause                                         | Solution                                                                                       |
| -------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Function timeout     | Operation exceeds `maxDuration` or plan limit | Increase `maxDuration` in `vercel.json`; check plan limits (Hobby: 10s, Pro: 60s)              |
| KV connection errors | KV store not linked or env vars missing       | Re-link the KV store in the Vercel dashboard; verify `KV_REST_API_URL` and `KV_REST_API_TOKEN` |
| 404 on API routes    | Rewrite rule missing or misconfigured         | Confirm `vercel.json` has `"source": "/(.*)"` rewriting to `/api/frontmcp`                     |
| Bundle too large     | Unnecessary dependencies included             | Run `frontmcp build --target vercel --analyze` and remove unused packages                      |
| Cold starts too slow | Low function memory or large bundle           | Increase memory to 1024 MB; audit dependencies; consider Vercel Fluid Compute                  |

## Reference

- **Docs:** https://docs.agentfront.dev/frontmcp/deployment/serverless
- **Related skills:** `deploy-to-node`, `deploy-to-lambda`
