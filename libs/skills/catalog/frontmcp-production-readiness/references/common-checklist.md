---
name: common-checklist
description: Security, performance, reliability, and observability checks for all deployment targets
---

# Common Production Readiness Checklist

These checks apply to ALL deployment targets. Run them first, then proceed to your target-specific checklist.

## Security

### Authentication & Authorization

- [ ] JWT_SECRET is set to a strong random value (not the default)
- [ ] Authentication is enabled (`auth` config in `@FrontMcp` or `@frontmcp/auth`)
- [ ] API keys/tokens are loaded from environment variables, never hardcoded
- [ ] Session storage uses Redis or platform-native store (not in-memory) for multi-instance
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

### Rate Limiting

- [ ] Rate limiting is configured for public-facing endpoints
- [ ] Per-client/per-IP limits are set
- [ ] Throttle configuration uses `@FrontMcp({ throttle: {...} })`
- [ ] Large payload limits are set to prevent memory exhaustion

### Dependencies

- [ ] `npm audit` shows no high/critical vulnerabilities
- [ ] Dependencies are pinned or use tilde ranges (not `*` or `latest`)
- [ ] No unused dependencies in package.json

## Performance

### Caching

- [ ] CachePlugin is configured for read-heavy tools
- [ ] Cache TTL is tuned per tool (not one-size-fits-all)
- [ ] Stale cache invalidation strategy is defined

### Response Optimization

- [ ] Large responses are paginated or streamed
- [ ] Tools return only necessary data (no over-fetching)
- [ ] Binary data uses proper encoding (base64 only when necessary)

### Memory Management

- [ ] No memory leaks from event listeners or unclosed connections
- [ ] Large data processing uses streams instead of buffering
- [ ] Provider lifecycle `dispose()` is implemented for cleanup
- [ ] Session storage has TTL to prevent unbounded growth

## Reliability

### Error Handling

- [ ] All tools use `this.fail()` with specific MCP error classes
- [ ] Unknown errors are caught and wrapped (never expose stack traces)
- [ ] Error responses include MCP error codes for client handling
- [ ] Async errors are properly caught (no unhandled promise rejections)

### Retry & Circuit Breaking

- [ ] External API calls have retry logic with exponential backoff
- [ ] Circuit breaker pattern for unreliable downstream services
- [ ] Timeouts are set for all external calls
- [ ] Job retries have maximum attempt limits

## Observability

### Logging

- [ ] Logs use structured format (JSON in production)
- [ ] Log levels are appropriate (info for normal, error for failures)
- [ ] Sensitive data is redacted from logs (tokens, passwords, PII)
- [ ] Request/response logging includes correlation IDs

### Monitoring

- [ ] Request count and latency metrics are exposed
- [ ] Error rate metrics are tracked
- [ ] Tool execution duration is measured
- [ ] Error tracking service is integrated (Sentry, Datadog, etc.)

## Jobs & Workflows (if enabled)

- [ ] Jobs Redis store is configured for production (`jobs: { enabled: true, store: { redis } }`)
- [ ] Job retry config has reasonable `maxAttempts` and `maxBackoffMs`
- [ ] Workflow timeout is set to prevent runaway workflows
- [ ] Job execution times are monitored (long-running jobs need alerting)
- [ ] Workflow step `continueOnError` is only used for non-critical steps

## Skills HTTP Endpoints (if enabled)

- [ ] Skills HTTP auth is configured (`skillsConfig.auth: 'api-key'` or `'bearer'`)
- [ ] Skills caching is enabled for production (`skillsConfig.cache: { enabled: true }`)
- [ ] Cache TTL is tuned for skill instruction freshness requirements
- [ ] `/llm.txt` and `/skills` endpoints are tested for correct responses

## ExtApps / Widgets (if enabled)

- [ ] Host capabilities are reviewed — only enable what widgets need
- [ ] `serverToolProxy` is disabled if widgets should not call MCP tools
- [ ] Widget session validation is active (default with HTTP transport)
- [ ] CSP headers are configured for hosted widget origins

## SQLite (if used)

- [ ] WAL mode is enabled for concurrent read/write performance
- [ ] Database file path is writable and persistent (not ephemeral storage)
- [ ] Backup strategy is defined (periodic file copy or WAL checkpoint)
- [ ] Database size is monitored to prevent disk exhaustion

## Documentation

- [ ] README.md is up-to-date for the deployment target (see `frontmcp-setup` → `references/readme-guide.md`)
- [ ] API documentation covers all tools and resources
- [ ] Environment variables are documented in `.env.example`

## Common Anti-Patterns

| Anti-Pattern              | Fix                                         |
| ------------------------- | ------------------------------------------- |
| Default JWT_SECRET        | Set a strong random secret                  |
| In-memory session store   | Use Redis or platform-native storage        |
| `cors: { origin: '*' }`   | Restrict to known origins                   |
| No output schema on tools | Always define `outputSchema`                |
| Synchronous file I/O      | Use async operations from `@frontmcp/utils` |
| Hardcoded secrets         | Use environment variables                   |
| Unbounded caching         | Set TTL on all caches                       |
