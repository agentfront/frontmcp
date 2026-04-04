---
name: frontmcp-observability
description: 'Use when you want to add tracing, structured logging, or monitoring to your FrontMCP server. Covers OpenTelemetry instrumentation, vendor integrations (Coralogix, Datadog, Logz.io, Grafana), this.telemetry API for custom spans, structured JSON logging with sinks, and testing observability. Triggers: observability, telemetry, tracing, logging, monitoring, opentelemetry, otel, spans, datadog, coralogix, logz, grafana, winston, pino.'
tags: [router, observability, telemetry, tracing, logging, monitoring, opentelemetry, otel, spans]
category: observability
targets: [all]
bundle: [recommended, full]
priority: 10
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/guides/observability
---

# FrontMCP Observability

Router for adding observability to FrontMCP servers. Covers distributed tracing (OpenTelemetry), structured JSON logging, per-request log collection, the `this.telemetry` developer API, and vendor integrations.

## When to Use This Skill

### Must Use

- Adding tracing, logging, or monitoring to a FrontMCP server
- Connecting Coralogix, Datadog, Logz.io, Grafana, or any OTLP backend
- Using `this.telemetry` to create custom spans in tools, plugins, or agents
- Setting up structured logging with winston, pino, or NDJSON stdout
- Testing that spans and log entries are created correctly

### Recommended

- Before going to production (see also `frontmcp-production-readiness`)
- When debugging request latency or error rates
- When building plugins that need trace context propagation

### Skip When

- Building a prototype that doesn't need observability yet
- Configuring auth, transport, or throttle (see `frontmcp-config`)
- Setting up the project from scratch (see `frontmcp-setup`)

> **Decision:** Use this skill when you need to observe, trace, or log your server. Start with `tracing-setup` for auto-instrumentation, add `structured-logging` for production logs, and use `telemetry-api` for custom spans in your code.

## Prerequisites

- A working FrontMCP server (see `frontmcp-setup`)
- `npm install @frontmcp/observability`

## Step 1: Choose What You Need

| I want to...                                       | Reference                             |
| -------------------------------------------------- | ------------------------------------- |
| Enable auto-tracing for all flows                  | `references/tracing-setup.md`         |
| Add structured JSON logging with trace correlation | `references/structured-logging.md`    |
| Create custom spans in tools/plugins               | `references/telemetry-api.md`         |
| Connect Coralogix, Datadog, Logz.io, Grafana       | `references/vendor-integrations.md`   |
| Test that spans and logs are correct               | `references/testing-observability.md` |

## Step 2: Enable Observability

The simplest way — one config line:

```typescript
@FrontMcp({
  observability: true,
})
```

This enables auto-tracing for all 33 SDK flows. Add structured logging:

```typescript
@FrontMcp({
  observability: {
    tracing: true,
    logging: { sinks: [{ type: 'stdout' }] },
    requestLogs: true,
  },
})
```

## Step 3: Read the Relevant Reference

Follow the scenario routing table above to find the right reference for your use case.

## Scenario Routing Table

| Scenario                             | Reference                             | Description                                                                 |
| ------------------------------------ | ------------------------------------- | --------------------------------------------------------------------------- |
| Enable OpenTelemetry tracing         | `references/tracing-setup.md`         | Zero-config auto-instrumentation, setupOTel(), span hierarchy               |
| Add JSON logs with trace correlation | `references/structured-logging.md`    | Sinks (stdout, console, OTLP, winston, pino), redaction, log format         |
| Custom spans in tools/plugins        | `references/telemetry-api.md`         | `this.telemetry.startSpan()`, `withSpan()`, `addEvent()`, `setAttributes()` |
| Connect to monitoring platforms      | `references/vendor-integrations.md`   | Coralogix, Datadog, Logz.io, Grafana — OTLP and direct                      |
| Test spans and log entries           | `references/testing-observability.md` | `createTestTracer()`, `assertSpanExists()`, integration test patterns       |

## Cross-Cutting Patterns

| Pattern              | Correct                                     | Incorrect                                         | Why                                                           |
| -------------------- | ------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| Enable observability | `observability: true` in `@FrontMcp` config | Import and install `ObservabilityPlugin` manually | Config-driven is the standard pattern since v1.0              |
| Custom spans         | `this.telemetry.withSpan('op', fn)`         | `trace.getTracer().startSpan()` directly          | `this.telemetry` auto-inherits trace context                  |
| Log correlation      | `this.logger.info('msg', { key: val })`     | `console.log('msg')`                              | SDK logger flows through StructuredLogTransport with trace_id |
| Session ID           | Use `mcp.session.id` attribute (hashed)     | Log the real session ID                           | Privacy: the hash is sufficient for correlation               |
| Vendor integration   | Use `{ type: 'otlp', endpoint }` sink       | Build vendor-specific HTTP clients                | OTLP is the universal standard                                |

## Quick Reference: What Gets Traced

| Category       | Flows                                                | Attributes                                        |
| -------------- | ---------------------------------------------------- | ------------------------------------------------- |
| HTTP requests  | traceRequest, auth, route, finalize                  | `http.request.method`, `url.path`                 |
| Tool calls     | parseInput → findTool → execute → finalize           | `mcp.component.type=tool`, `enduser.id`           |
| Resource reads | parseInput → findResource → execute                  | `mcp.component.type=resource`, `mcp.resource.uri` |
| Prompts        | parseInput → findPrompt → execute                    | `mcp.component.type=prompt`                       |
| Agents         | parseInput → findAgent → execute (nested tool calls) | `mcp.component.type=agent`                        |
| Auth           | verify, session verify, OAuth flows                  | `frontmcp.auth.mode`, `frontmcp.auth.result`      |
| Transport      | SSE, Streamable HTTP, Stateless HTTP                 | `frontmcp.transport.type`                         |
| Skills         | search, load, HTTP endpoints                         | `frontmcp.flow.name`                              |

## Verification Checklist

### Configuration

- [ ] `@frontmcp/observability` installed
- [ ] `observability` field added to `@FrontMcp` config
- [ ] TracerProvider configured (via `setupOTel()` or external SDK)
- [ ] Logging sinks configured for production (stdout or OTLP)

### Runtime

- [ ] Spans appear in trace backend when calling a tool
- [ ] Log entries include `trace_id` and `span_id`
- [ ] `this.telemetry` is available in tool execution contexts
- [ ] Session tracing ID is consistent across all spans in a request
- [ ] Errors are recorded on spans with `ERROR` status

### Testing

- [ ] Tests verify span creation with `createTestTracer()`
- [ ] Tests verify log entries via `CallbackSink`
- [ ] No test isolation issues (each test resets exporter)

## Reference

- [Observability Guide](https://docs.agentfront.dev/frontmcp/guides/observability)
- [Telemetry API Reference](https://docs.agentfront.dev/frontmcp/sdk-reference/telemetry)
- Related skills: `frontmcp-production-readiness`, `frontmcp-config`, `frontmcp-testing`, `frontmcp-development`
