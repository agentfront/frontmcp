---
name: frontmcp-observability
description: 'Use when adding tracing, structured logging, metrics, or monitoring to a FrontMCP server. Covers zero-config OpenTelemetry distributed tracing across all flows; the this.telemetry API for custom spans, events, and attributes in tools, plugins, agents, and skills; structured JSON logging with trace correlation and configurable sinks (Winston, Pino, stdout); the off-by-default /metrics endpoint (process and framework metrics, Prometheus-compatible); vendor integrations (Coralogix, Datadog, Logz.io, Grafana Cloud, or any OTLP backend); and testing spans, log correlation, and instrumentation. Triggers: observability, telemetry, tracing, logging, monitoring, OpenTelemetry, OTel, spans, metrics, Prometheus, Datadog, Coralogix, Logz.io, Grafana, Winston, Pino.'
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
| Expose Prometheus `/metrics` endpoint              | `references/metrics-endpoint.md`      |

## Step 2: Enable Observability

The simplest way — one config line:

```typescript
@FrontMcp({
  observability: true,
})
```

This enables auto-tracing for all SDK flows. Add structured logging:

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

| Scenario                              | Reference                             | Description                                                                 |
| ------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| Enable OpenTelemetry tracing          | `references/tracing-setup.md`         | Zero-config auto-instrumentation, setupOTel(), span hierarchy               |
| Add JSON logs with trace correlation  | `references/structured-logging.md`    | Sinks (stdout, console, OTLP, winston, pino), redaction, log format         |
| Custom spans in tools/plugins         | `references/telemetry-api.md`         | `this.telemetry.startSpan()`, `withSpan()`, `addEvent()`, `setAttributes()` |
| Connect to monitoring platforms       | `references/vendor-integrations.md`   | Coralogix, Datadog, Logz.io, Grafana — OTLP and direct                      |
| Test spans and log entries            | `references/testing-observability.md` | `createTestTracer()`, `assertSpanExists()`, integration test patterns       |
| Expose Prometheus `/metrics` endpoint | `references/metrics-endpoint.md`      | Off-by-default Prometheus scrape endpoint with process + framework counters |

## Common Patterns

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

## Troubleshooting

| Problem                                          | Cause                                                         | Solution                                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `this.telemetry` is undefined in a tool          | `observability` not enabled on the parent `@FrontMcp` config  | Set `observability: true` (or a config object) in the `@FrontMcp` decorator; see `tracing-setup`                          |
| Spans appear without `trace_id` in logs          | Logger not connected to `StructuredLogTransport`              | Use `this.logger`, not `console`; see `structured-logging`                                                                |
| OTLP exporter silently drops spans               | Endpoint URL points at the UI, not the OTLP collector         | Use the OTLP HTTP/gRPC ingest endpoint exposed by your vendor (Datadog, Coralogix, Logz, etc.); see `vendor-integrations` |
| Real session ID appears in span attributes       | A custom span attribute writes `session.id` directly          | Use the SDK-provided `mcp.session.id` (already hashed); never log the raw session token                                   |
| Tests randomly fail with leftover spans          | Exporter retained between tests                               | Reset the in-memory exporter in `afterEach`; see `testing-observability`                                                  |
| OTel auto-instrumentation double-traces requests | Both `setupOTel()` AND a vendor agent attached to the process | Pick one: either FrontMCP-managed OTel OR the vendor agent — not both                                                     |

## Examples

Each reference has matching examples under [`examples/<reference>/`](./examples/):

### `tracing-setup`

| Example                                                                | Level        | Description                                                                                            |
| ---------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| [`basic-tracing`](./examples/tracing-setup/basic-tracing.md)           | Basic        | Enable auto-tracing and see spans printed to your terminal.                                            |
| [`production-tracing`](./examples/tracing-setup/production-tracing.md) | Intermediate | Full production observability — traces to OTLP, structured logs to stdout, per-request log collection. |

### `structured-logging`

| Example                                                                       | Level        | Description                                                                                                                    |
| ----------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| [`stdout-logging`](./examples/structured-logging/stdout-logging.md)           | Basic        | Enable NDJSON structured logging to stdout with automatic trace correlation and field redaction.                               |
| [`winston-integration`](./examples/structured-logging/winston-integration.md) | Intermediate | Forward FrontMCP structured log entries to your existing winston logger. Each entry includes trace_id and span_id as metadata. |

### `telemetry-api`

| Example                                                                    | Level        | Description                                                                                                                                               |
| -------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`tool-custom-spans`](./examples/telemetry-api/tool-custom-spans.md)       | Basic        | Create child spans, events, and attributes inside a tool's execute method using this.telemetry.                                                           |
| [`plugin-telemetry`](./examples/telemetry-api/plugin-telemetry.md)         | Intermediate | Add telemetry events from a custom plugin's hooks. Events appear on the tool execution span, giving you visibility into plugin behavior within the trace. |
| [`agent-nested-tracing`](./examples/telemetry-api/agent-nested-tracing.md) | Advanced     | Trace an agent's execution lifecycle including its nested tool calls. Every span shares the same trace ID.                                                |

### `vendor-integrations`

| Example                                                                | Level        | Description                                                                                                               |
| ---------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| [`coralogix-setup`](./examples/vendor-integrations/coralogix-setup.md) | Intermediate | Send both traces and structured logs to Coralogix. Logs include trace_id so Coralogix links them to traces automatically. |

### `testing-observability`

| Example                                                                            | Level        | Description                                                                                 |
| ---------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------- |
| [`test-custom-spans`](./examples/testing-observability/test-custom-spans.md)       | Basic        | Verify that your tool creates the expected child spans with correct attributes.             |
| [`test-log-correlation`](./examples/testing-observability/test-log-correlation.md) | Intermediate | Verify that structured log entries include trace context fields for correlation with spans. |

### `metrics-endpoint`

| Example                                                                             | Level | Description                                                          |
| ----------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------- |
| [`enable-metrics-endpoint`](./examples/metrics-endpoint/enable-metrics-endpoint.md) | Basic | Turn on the /metrics endpoint with defaults and scrape it with curl. |

## Accessing This Skill

Skills are distributed as plain SKILL.md files plus a sibling `references/`
and `examples/` tree, so consumers can pick whichever access mode fits:

| Mode               | How it works                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Filesystem**     | Read `libs/skills/catalog/frontmcp-observability/` directly from a clone of the catalog repo, or from a published `@frontmcp/skills` install. SKILL.md is the entry point.                                                                                                                                                                                    |
| **`frontmcp` CLI** | `frontmcp skills list`, `frontmcp skills read frontmcp-observability`, `frontmcp skills read frontmcp-observability:references/<file>.md`, `frontmcp skills install frontmcp-observability` — no server required.                                                                                                                                             |
| **MCP `skill://`** | When a developer mounts this skill into their own FrontMCP server (`@FrontMcp({ skills: [...] })`), the SDK exposes it via SEP-2640 resources: `skill://frontmcp-observability/SKILL.md`, `skill://frontmcp-observability/references/{file}.md`, etc. The server’s `skill://index.json` returns the SEP-2640 discovery document for everything mounted on it. |

The catalog itself is **not** an MCP server. The `skill://` URIs only resolve
when a server has been configured to host this skill.

## Reference

- [Observability Guide](https://docs.agentfront.dev/frontmcp/guides/observability)
- [Telemetry API Reference](https://docs.agentfront.dev/frontmcp/sdk-reference/telemetry)
- Related skills: `frontmcp-production-readiness`, `frontmcp-config`, `frontmcp-testing`, `frontmcp-development`
