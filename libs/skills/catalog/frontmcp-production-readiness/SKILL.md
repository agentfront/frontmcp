---
name: frontmcp-production-readiness
description: 'Pre-production audit and checklist for FrontMCP servers. Use before go-live to verify security hardening, performance checks, observability, monitoring, and health checks. Triggers: production ready, security audit, performance check, production checklist, hardening, go live.'
tags: [production, security, performance, reliability, observability, audit, best-practices]
category: production
targets: [all]
bundle: [recommended, full]
priority: 10
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/deployment/production-build
---

# FrontMCP Production Readiness Audit

Router for production readiness checklists. Start with the common checklist (security, performance, reliability, observability), then follow the target-specific checklist for your deployment environment.

## When to Use This Skill

### Must Use

- Before deploying a FrontMCP server to production for the first time
- After major feature additions or architectural changes
- During security reviews or compliance audits

### Recommended

- As part of PR reviews for infrastructure-touching changes
- Quarterly health checks on production deployments
- When switching deployment targets

### Skip When

- Building a prototype or proof-of-concept
- Running in development/local mode only

> **Decision:** Use this skill when preparing for production. Start with `common-checklist`, then pick your deployment target.

## Step 1: Detect Deployment Target

Check the project to determine the deployment target:

1. Look at `package.json` scripts for `frontmcp build --target <target>`
2. Check for target-specific files: `ci/Dockerfile` (node), `vercel.json` (vercel), `wrangler.toml` (cloudflare), `ci/template.yaml` (lambda)
3. Check if the build target is `cli` or `browser` in the build config
4. If unclear, ask the user which environment they're deploying to

## Step 2: Run Common Checklist

Always start with the common checklist — it covers security, performance, reliability, and observability that apply to every target.

## Step 3: Run Target-Specific Checklist

After the common checklist, run the checklist for your deployment target.

## Scenario Routing Table

| Scenario                                                 | Reference                              | Description                                         |
| -------------------------------------------------------- | -------------------------------------- | --------------------------------------------------- |
| Common security, performance, reliability, observability | `references/common-checklist.md`       | Applies to ALL targets — run this first             |
| Standalone Node.js server with Docker                    | `references/production-node-server.md` | Docker, health checks, Redis, scaling, CI/CD        |
| Node.js SDK / direct client (npm package)                | `references/production-node-sdk.md`    | create()/connect() API, disposal, npm publishing    |
| Vercel serverless / edge                                 | `references/production-vercel.md`      | Vercel config, edge runtime, cold starts, Vercel KV |
| Cloudflare Workers                                       | `references/production-cloudflare.md`  | Wrangler, Workers runtime, KV, Durable Objects      |
| AWS Lambda                                               | `references/production-lambda.md`      | SAM template, cold starts, DynamoDB, API Gateway    |
| CLI daemon (local MCP server)                            | `references/production-cli-daemon.md`  | Process manager, socket files, service registration |
| CLI binary (one-shot execution)                          | `references/production-cli-binary.md`  | Fast startup, stdio transport, exit codes, npm bin  |
| Browser SDK                                              | `references/production-browser.md`     | Bundle size, browser APIs, CSP, CDN distribution    |

## Quick Reference: Target Detection

| File / Signal Found                                   | Target                                          |
| ----------------------------------------------------- | ----------------------------------------------- |
| `ci/Dockerfile` or `ci/docker-compose.yml`            | Standalone server → `production-node-server.md` |
| `serve: false` or `create()` API usage                | SDK / direct client → `production-node-sdk.md`  |
| `vercel.json`                                         | Vercel → `production-vercel.md`                 |
| `wrangler.toml`                                       | Cloudflare → `production-cloudflare.md`         |
| `ci/template.yaml`                                    | Lambda → `production-lambda.md`                 |
| `frontmcp start` / `socket` / `service install` usage | CLI daemon → `production-cli-daemon.md`         |
| `build --target cli` + `bin` in package.json          | CLI binary → `production-cli-binary.md`         |
| `build --target browser` in scripts                   | Browser → `production-browser.md`               |

## Verification Checklist

After completing both common and target-specific checklists:

1. Run `frontmcp doctor` to check project configuration
2. Run `frontmcp test` to ensure all tests pass
3. Run `frontmcp build` to verify production build succeeds
4. Deploy to staging and run E2E tests against it
5. Review logs for any warnings or errors during startup
6. Update README for the deployment target (see `frontmcp-setup` → `references/readme-guide.md`)

## Reference

- [Production Build](https://docs.agentfront.dev/frontmcp/deployment/production-build)
- Related skills: `frontmcp-config`, `frontmcp-deployment`, `frontmcp-testing`, `frontmcp-setup`
