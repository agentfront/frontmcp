---
name: frontmcp-production-readiness
description: 'Production readiness audit for FrontMCP servers — security hardening, performance optimization, reliability patterns, observability, and deployment best practices.'
tags: [production, security, performance, reliability, observability, audit, best-practices]
priority: 10
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/production/overview
---

# FrontMCP Production Readiness Audit

Comprehensive audit skill for preparing FrontMCP servers for production deployment. Reviews security, performance, reliability, observability, and deployment configuration.

## When to Use This Skill

### Must Use

- Before deploying a FrontMCP server to production for the first time
- After major feature additions or architectural changes
- During security reviews or compliance audits
- When troubleshooting production issues (performance, crashes, security incidents)

### Recommended

- As part of PR reviews for infrastructure-touching changes
- Quarterly health checks on production deployments
- When onboarding new team members to understand production requirements

### Skip When

- Building a prototype or proof-of-concept (focus on functionality first)
- Running in development/local mode only
- The server has no external exposure (purely internal MCP client)

> **Decision:** Use this skill when preparing for or auditing a production deployment. Reference `security-checklist` or `performance-checklist` for deep dives into specific areas.

## Scenario Routing Table

| Scenario                             | Section / Reference         | Description                                                      |
| ------------------------------------ | --------------------------- | ---------------------------------------------------------------- |
| Full production audit before go-live | All sections below          | Walk through every checklist                                     |
| Security-focused audit               | `security-checklist`        | Auth, CORS, input validation, secrets, rate limiting             |
| Performance optimization             | `performance-checklist`     | Caching, connection pooling, response optimization, memory leaks |
| Reliability and error handling       | Reliability section below   | Error handling, graceful shutdown, health checks, retries        |
| Observability setup                  | Observability section below | Structured logging, metrics, error tracking                      |
| Deployment configuration review      | Deployment section below    | Docker, env vars, CI/CD, scaling                                 |

## Security Checklist

### Authentication & Authorization

- [ ] JWT_SECRET is set to a strong random value (not the default)
- [ ] Authentication is enabled (`auth` config in `@FrontMcp` or `@frontmcp/auth`)
- [ ] API keys/tokens are loaded from environment variables, never hardcoded
- [ ] Session storage uses Redis (not in-memory) for multi-instance deployments
- [ ] Session TTL is configured appropriately (not infinite)
- [ ] Tool-level authorization is enforced where needed (ApprovalPlugin or custom)
- [ ] OAuth redirect URIs are restricted to known domains

### CORS Configuration

- [ ] CORS is NOT permissive (don't allow all origins in production)
- [ ] Specific allowed origins are listed: `cors: { origin: ['https://your-app.com'] }`
- [ ] Credentials mode is only enabled if cookies/sessions are needed
- [ ] Preflight cache (`maxAge`) is set to reduce OPTIONS requests

### Input Validation

- [ ] All tool inputs use Zod schemas (never trust raw input)
- [ ] All tool outputs use `outputSchema` to prevent data leaks
- [ ] Path parameters and query params are validated
- [ ] File paths are sanitized to prevent directory traversal
- [ ] SQL queries use parameterized statements (never string interpolation)

### Secrets Management

- [ ] No secrets in source code or git history
- [ ] `.env` files are in `.gitignore`
- [ ] Production secrets are managed via secret manager (AWS SSM, Vault, etc.)
- [ ] API keys have minimum required permissions
- [ ] Secrets are rotated on a schedule

### Rate Limiting & Abuse Prevention

- [ ] Rate limiting is configured for public-facing endpoints
- [ ] Per-client/per-IP limits are set
- [ ] Throttle configuration uses `@FrontMcp({ throttle: {...} })`
- [ ] Large payload limits are set to prevent memory exhaustion

### Dependency Security

- [ ] `npm audit` or `yarn audit` shows no high/critical vulnerabilities
- [ ] Dependencies are pinned or use tilde ranges (not `*` or `latest`)
- [ ] No unused dependencies in package.json

## Performance Checklist

### Caching

- [ ] CachePlugin is configured for read-heavy tools
- [ ] Cache TTL is tuned per tool (not one-size-fits-all)
- [ ] Cache uses Redis in production (not in-memory)
- [ ] Cache bypass header is configured for debugging
- [ ] Stale cache invalidation strategy is defined

### Connection Management

- [ ] Redis connection pooling is configured (not one connection per request)
- [ ] Database connections use connection pools
- [ ] HTTP client connections use keep-alive
- [ ] Connection timeouts are set (don't hang indefinitely)

### Response Optimization

- [ ] Large responses are paginated or streamed
- [ ] Tools return only necessary data (no over-fetching)
- [ ] OpenAPI adapter responses are not unnecessarily large
- [ ] Binary data uses proper encoding (base64 only when necessary)

### Memory Management

- [ ] No memory leaks from event listeners or unclosed connections
- [ ] Large data processing uses streams instead of buffering
- [ ] Provider lifecycle `dispose()` is implemented for cleanup
- [ ] Session storage has TTL to prevent unbounded growth

### Startup Performance

- [ ] Server startup time is acceptable (< 5s for most apps)
- [ ] Lazy-load expensive dependencies (ML models, large configs)
- [ ] OpenAPI spec fetching uses caching and doesn't block startup

## Reliability Checklist

### Error Handling

- [ ] All tools use `this.fail()` with specific MCP error classes
- [ ] Unknown errors are caught and wrapped (never expose stack traces)
- [ ] Error responses include MCP error codes for client handling
- [ ] Async errors are properly caught (no unhandled promise rejections)

### Graceful Shutdown

- [ ] SIGTERM handler is configured for clean shutdown
- [ ] In-flight requests complete before process exit
- [ ] Redis/database connections are closed on shutdown
- [ ] Health check returns unhealthy during shutdown drain

### Health Checks

- [ ] `/health` endpoint is implemented and monitored
- [ ] Health check verifies downstream dependencies (Redis, databases)
- [ ] Readiness probe is separate from liveness probe (K8s)
- [ ] Health check doesn't perform expensive operations

### Retry & Circuit Breaking

- [ ] External API calls have retry logic with exponential backoff
- [ ] Circuit breaker pattern for unreliable downstream services
- [ ] Timeouts are set for all external calls
- [ ] Job retries have maximum attempt limits

## Observability Checklist

### Structured Logging

- [ ] Logs use structured format (JSON in production)
- [ ] Log levels are appropriate (info for normal, error for failures)
- [ ] Sensitive data is redacted from logs (tokens, passwords, PII)
- [ ] Request/response logging includes correlation IDs
- [ ] Log volume is manageable (not logging every request body)

### Metrics

- [ ] Request count and latency metrics are exposed
- [ ] Error rate metrics are tracked
- [ ] Tool execution duration is measured
- [ ] Resource utilization (memory, CPU) is monitored

### Error Tracking

- [ ] Unhandled errors are captured and reported
- [ ] Error tracking service is integrated (Sentry, Datadog, etc.)
- [ ] Error alerts are configured for critical failures
- [ ] Error context includes tool name, input summary, and user context

## Deployment Checklist

### Docker & Containers

- [ ] Dockerfile uses multi-stage build (separate build and runtime stages)
- [ ] Base image is minimal (node:slim, not full node image)
- [ ] Non-root user is configured in the container
- [ ] `.dockerignore` excludes dev files, node_modules, .git
- [ ] Container health check is defined
- [ ] Resource limits (memory, CPU) are set in deployment config

### Environment Configuration

- [ ] `NODE_ENV=production` is set
- [ ] All required env vars are documented in `.env.example`
- [ ] Env vars are validated at startup (fail fast on missing config)
- [ ] Port binding uses `process.env.PORT` for platform compatibility
- [ ] No dev dependencies are installed in production (`npm install --production`)

### CI/CD Pipeline

- [ ] Tests run on every PR (unit + E2E)
- [ ] Build step produces optimized output (`frontmcp build`)
- [ ] Docker image is built and pushed automatically
- [ ] Deployment is automated with rollback capability
- [ ] Database migrations run as separate step (not in server startup)

### Scaling

- [ ] Server is stateless (session state in Redis, not memory)
- [ ] Multiple instances can run behind a load balancer
- [ ] WebSocket/SSE connections are handled by sticky sessions or Redis pub/sub
- [ ] Auto-scaling is configured based on CPU/memory/request metrics

## Common Anti-Patterns

| Anti-Pattern              | Why It's Bad                                 | Fix                                         |
| ------------------------- | -------------------------------------------- | ------------------------------------------- |
| Default JWT_SECRET        | Anyone can forge tokens                      | Set a strong random secret                  |
| In-memory session store   | Lost on restart, not shared across instances | Use Redis                                   |
| `cors: { origin: '*' }`   | Any website can call your server             | Restrict to known origins                   |
| No output schema on tools | May leak internal data                       | Always define `outputSchema`                |
| Synchronous file I/O      | Blocks event loop                            | Use async operations from `@frontmcp/utils` |
| Hardcoded secrets         | Committed to git, visible in source          | Use environment variables                   |
| No health check           | Can't detect unhealthy instances             | Implement `/health` endpoint                |
| Unbounded caching         | Memory grows forever                         | Set TTL on all caches                       |

## Verification

After completing this audit:

1. Run `frontmcp doctor` to check project configuration
2. Run `frontmcp test` to ensure all tests pass
3. Run `frontmcp build` to verify production build succeeds
4. Deploy to staging and run E2E tests against it
5. Review logs for any warnings or errors during startup
6. Load test with expected production traffic patterns

## Reference

- [FrontMCP Production Guide](https://docs.agentfront.dev/frontmcp/production)
- Related skills: `frontmcp-config`, `frontmcp-deployment`, `frontmcp-testing`
