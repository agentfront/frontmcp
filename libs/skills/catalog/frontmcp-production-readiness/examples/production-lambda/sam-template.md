---
name: sam-template
reference: production-lambda
level: basic
description: 'Checklist for verifying the SAM template pairs correctly with the bundle produced by `frontmcp build --target lambda`. **Note:** configuration authoring lives in `frontmcp-deployment → references/deploy-to-lambda.md`; this file is checklist-only.'
tags:
  - production
  - lambda
  - session
  - sam
  - checklist
features:
  - 'Verify `Handler: dist/handler.handler` (the build emits `dist/handler.cjs`)'
  - No hand-written `src/lambda.ts` with a fictional `createLambdaHandler` import
  - DynamoDB session table has TTL enabled for automatic cleanup
  - IAM policies are scoped (no `*` resources / actions)
  - API Gateway proxy route forwards to the function
---

# SAM Template: Production-Readiness Checklist

Checklist for verifying the SAM template pairs correctly with the bundle produced by `frontmcp build --target lambda`. **Note:** configuration authoring lives in `frontmcp-deployment → references/deploy-to-lambda.md`; this file is checklist-only.

## Build artifact checks

- [ ] `frontmcp build --target lambda` succeeded with no warnings
- [ ] `dist/handler.cjs` exists — this is the bundled handler the rspack adapter writes
- [ ] No hand-written `src/lambda.ts` importing a fictional `createLambdaHandler` from `@frontmcp/adapters/lambda` — the build adapter generates the entry; your code stays the decorated `@FrontMcp` class
- [ ] `Handler: dist/handler.handler` in `template.yaml` (filename `handler.cjs` → handler symbol `handler`). NOT `dist/lambda.handler`
- [ ] `CodeUri: .` (or pointed at the project root containing `dist/`) so SAM packages the bundled handler

## Function configuration

- [ ] `Runtime: nodejs20.x` (or current LTS)
- [ ] `MemorySize` and `Timeout` sized to your workload (defaults: 256 MB / 30 s)
- [ ] `Environment.Variables` includes `NODE_ENV: production` and any required app env
- [ ] Reserved or provisioned concurrency set for latency-sensitive endpoints

## Session / state

- [ ] DynamoDB session table has `BillingMode: PAY_PER_REQUEST` (or capacity sized correctly)
- [ ] `TimeToLiveSpecification.AttributeName: ttl` and `Enabled: true` for automatic session cleanup
- [ ] In `@FrontMcp`, sessions point at DynamoDB / ElastiCache — never in-memory in Lambda
- [ ] No filesystem writes outside `/tmp` (default 512 MB; configurable up to 10 GB via SAM `EphemeralStorage` if needed)

## API Gateway / routing

- [ ] Path is `/mcp/{proxy+}` with `Method: ANY` so MCP transport reaches the handler
- [ ] CORS configured at API Gateway OR via `@FrontMcp` `cors`, not both
- [ ] Stage names (`Prod` / `Staging`) match deploy pipeline

## IAM hardening

- [ ] No `Action: '*'` or `Resource: '*'` in the function's policies
- [ ] DynamoDB access scoped to `!Ref SessionTable` only
- [ ] Secrets read via SSM / Secrets Manager scoped to `/<app>/<env>/*`

## Observability

- [ ] CloudWatch alarm on `Errors` metric
- [ ] CloudWatch alarm on `Throttles` metric
- [ ] Dead Letter Queue (SQS) configured for failed async invocations

## What This Demonstrates

- Verify `Handler: dist/handler.handler` (the build emits `dist/handler.cjs`)
- No hand-written `src/lambda.ts` with a fictional `createLambdaHandler` import
- DynamoDB session table has TTL enabled for automatic cleanup
- IAM policies are scoped (no `*` resources / actions)
- API Gateway proxy route forwards to the function

## Related

- Configuration source of truth: `frontmcp-deployment/references/deploy-to-lambda.md`
- Build adapter source: `libs/cli/src/commands/build/adapters/lambda.ts`
- See `production-lambda` for the runtime / scaling checklist
