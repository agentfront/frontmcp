---
name: deploy-to-vercel
description: Deploy a FrontMCP server to Vercel serverless functions with Vercel KV storage
---

# Deploy a FrontMCP Server to Vercel

This skill guides you through deploying a FrontMCP server to Vercel serverless functions with Vercel KV for persistent storage.

The FrontMCP CLI's Vercel adapter uses Vercel's [Build Output API v3](https://vercel.com/docs/build-output-api/v3): it produces `.vercel/output/functions/index.func/handler.cjs` plus `.vercel/output/config.json`. You do **not** author `api/frontmcp.ts` files, and you do **not** hand-write `rewrites` to `/api/frontmcp` — the build emits the full Build Output structure for you.

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
- A FrontMCP project ready to build

## Step 1: Build for Vercel

```bash
frontmcp build --target vercel
```

This produces a Vercel Build Output API v3 structure:

```text
.vercel/output/
├── config.json                            # routes /(.*) -> /index function
└── functions/
    └── index.func/
        ├── .vc-config.json                # nodejs24.x runtime + handler.cjs
        ├── handler.cjs                    # bundled handler (rspack CJS)
        ├── package.json                   # peer-dep manifest (vercel-kv, etc.)
        └── node_modules/                  # peer deps that can't be statically bundled

vercel.json                                # version, buildCommand, installCommand
```

The adapter detects your package manager from the lockfile and writes the matching `buildCommand`/`installCommand` into `vercel.json`. No `api/` directory is involved.

## Step 2: Configure the Server for Vercel KV

Use the `vercel-kv` provider so FrontMCP stores sessions, skill cache, and plugin state in Vercel KV (powered by Upstash Redis):

```typescript
import { App, FrontMcp } from '@frontmcp/sdk';

@App({ name: 'MyApp' })
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

export default MyServer;
```

Provision the KV store in the Vercel dashboard under **Storage > Create Database > KV (Redis)**, then link it to your project. Vercel automatically injects the required environment variables.

## Step 3: Environment Variables

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

## Step 4: Deploy

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

## Step 5: Verify

```bash
# Health check (FrontMCP serves /healthz by default; /health is a legacy alias)
curl https://your-project.vercel.app/healthz

# Test MCP endpoint
curl -X POST https://your-project.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## Cold Start Notes

Vercel serverless functions experience cold starts after periods of inactivity. To minimize impact:

- The `frontmcp build --target vercel` output is bundled with rspack (CJS) for fast load. Avoid adding unnecessary dependencies.
- Consider Vercel's **Fluid Compute** for latency-sensitive workloads.
- Configure memory in the Vercel dashboard (Project Settings > Functions). The build-generated `.vc-config.json` does not pin memory; Vercel applies project defaults.

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

| Pattern               | Correct                                                  | Incorrect                                  | Why                                                                     |
| --------------------- | -------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| Build command         | `frontmcp build --target vercel`                         | `tsc` or generic `npm run build`           | The Vercel adapter emits the Build Output API v3 structure              |
| KV provider config    | `{ provider: 'vercel-kv' }`                              | `{ provider: 'redis', host: '...' }`       | Vercel KV uses its own REST API; a raw Redis provider will not connect  |
| Function entry        | `.vercel/output/functions/index.func/handler.cjs` (auto) | Hand-written `api/frontmcp.ts`             | The adapter generates the function via Build Output API; no `api/` dir  |
| Routing               | `.vercel/output/config.json` (auto)                      | Hand-written `rewrites` to `/api/frontmcp` | The adapter writes `routes: [{ src: '/(.*)', dest: '/index' }]` for you |
| Environment variables | Link KV store in dashboard (auto-injected)               | Hardcode `KV_REST_API_URL` in source       | Linked stores inject vars automatically and rotate tokens safely        |

## Verification Checklist

**Build**

- [ ] `frontmcp build --target vercel` completes without errors
- [ ] `.vercel/output/functions/index.func/handler.cjs` exists in the build output
- [ ] `.vercel/output/config.json` contains a route from `/(.*)` to `/index`

**Deployment**

- [ ] `vercel` creates a preview deployment without errors
- [ ] `vercel --prod` deploys to the production domain
- [ ] `curl https://your-project.vercel.app/healthz` returns `{"status":"ok"}`

**Storage and Configuration**

- [ ] Vercel KV store is created and linked to the project
- [ ] `KV_REST_API_URL` and `KV_REST_API_TOKEN` are present in environment variables
- [ ] `NODE_ENV` is set to `production`

**Production Readiness**

- [ ] Custom domain is configured with DNS pointing to Vercel
- [ ] TLS certificate is provisioned (automatic on Vercel)

## Troubleshooting

| Problem              | Cause                                   | Solution                                                                                       |
| -------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Function timeout     | Operation exceeds plan's max duration   | Check plan limits (Hobby: 10s, Pro: 60s); upgrade plan or refactor the slow tool               |
| KV connection errors | KV store not linked or env vars missing | Re-link the KV store in the Vercel dashboard; verify `KV_REST_API_URL` and `KV_REST_API_TOKEN` |
| 404 on every route   | Build did not produce `.vercel/output/` | Ensure `frontmcp build --target vercel` ran before `vercel` deploys                            |
| Bundle too large     | Unnecessary dependencies included       | Review dependencies and remove unused packages to reduce bundle size                           |
| Cold starts too slow | Heavy decorator initialization          | Lazy-load providers; defer heavy work until first tool call                                    |

## Examples

| Example                                                                                | Level        | Description                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`vercel-mcp-endpoint-test`](../examples/deploy-to-vercel/vercel-mcp-endpoint-test.md) | Advanced     | Verify a Vercel-deployed FrontMCP server by testing health, tool listing, and tool invocation. The CLI emits the Build Output API v3 structure — there is no `api/frontmcp.ts` to test against; the function lives at `.vercel/output/functions/index.func/handler.cjs` and is routed via `.vercel/output/config.json`. |
| [`vercel-with-kv`](../examples/deploy-to-vercel/vercel-with-kv.md)                     | Basic        | Deploy a FrontMCP server to Vercel serverless functions with Vercel KV for session persistence. The CLI emits the full Build Output API v3 structure for you — you do **not** author `api/frontmcp.ts` and you do **not** add a `rewrites` block.                                                                       |
| [`vercel-with-skills-cache`](../examples/deploy-to-vercel/vercel-with-skills-cache.md) | Intermediate | Deploy a FrontMCP server to Vercel with skills enabled and KV-backed skill caching. The CLI handles the Build Output API v3 emission for you — your job is to configure the server and provision Vercel KV.                                                                                                             |

> See all examples in [`examples/deploy-to-vercel/`](../examples/deploy-to-vercel/)

## Reference

- **Vercel Build Output API v3:** https://vercel.com/docs/build-output-api/v3
- **Related skills:** `deploy-to-node`, `deploy-to-lambda`
