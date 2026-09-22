---
name: structured-logging
description: 'Add structured JSON logging with trace correlation and configurable sinks (stdout, winston, pino, OTLP).'
tags: [logging, structured, json, sinks, ndjson, winston, pino, redaction]
---

# Structured Logging

Add structured JSON logging that enriches every log entry with `trace_id`, `span_id`, `request_id`, and `session_id_hash`. Logs flow through configurable sinks — stdout (NDJSON), winston, pino, OTLP, console, or custom callbacks.

## How It Works

```
this.logger.info('message', { userId: 123 })
    │
    ├── ConsoleLogTransport (dev console — pretty colored output)
    │
    └── StructuredLogTransport (enriches with trace context)
          ├── StdoutSink → NDJSON to stdout (Docker/K8s collects)
          ├── OtlpSink → OTLP HTTP to Coralogix/Datadog/Logz.io
          ├── WinstonSink → forward to winston instance
          ├── PinoSink → forward to pino instance
          └── CallbackSink → custom handler function
```

## Enable Structured Logging

```typescript
@FrontMcp({
  observability: {
    tracing: true,
    logging: true,          // Default: StdoutSink (NDJSON)
  },
})
```

## Log Entry Format

Every `this.logger.info()` call produces:

```json
{
  "timestamp": "2026-04-03T10:15:30.123Z",
  "level": "info",
  "severity_number": 9,
  "message": "processing user request",
  "trace_id": "abcdef1234567890abcdef1234567890",
  "span_id": "1234567890abcdef",
  "request_id": "req-uuid-001",
  "session_id_hash": "a3f8b2c1d4e5f6a7",
  "scope_id": "my-app",
  "flow_name": "tools:call-tool",
  "elapsed_ms": 42,
  "prefix": "MyTool",
  "attributes": { "userId": 123 }
}
```

## Configure Sinks

```typescript
observability: {
  logging: {
    sinks: [
      { type: 'stdout' },                                    // NDJSON to stdout
      { type: 'console' },                                   // console.log (browser-safe)
      { type: 'otlp', endpoint: 'http://collector:4318' },   // OTLP to any backend
      { type: 'winston', logger: winstonInstance },           // Forward to winston
      { type: 'pino', logger: pinoInstance },                 // Forward to pino
      { type: 'callback', fn: (entry) => queue.push(entry) },// Custom handler
    ],
    redactFields: ['password', 'token', 'secret', 'authorization'],
    includeStacks: process.env.NODE_ENV !== 'production',
    staticFields: { service: 'my-server', env: 'production' },
  },
}
```

## Sink Types

| Type       | Output                       | Environment      | Use Case                             |
| ---------- | ---------------------------- | ---------------- | ------------------------------------ |
| `stdout`   | NDJSON to `process.stdout`   | Node.js          | 12-factor apps, Docker, K8s          |
| `console`  | `console.log/warn/error`     | Browser, Node.js | Local dev, browser apps              |
| `otlp`     | OTLP HTTP POST to `/v1/logs` | Node.js          | Coralogix, Datadog, Logz.io, Grafana |
| `winston`  | Forward to winston instance  | Node.js          | Existing winston setup               |
| `pino`     | Forward to pino instance     | Node.js          | Existing pino setup                  |
| `callback` | User-provided function       | Any              | Custom integrations                  |

## Field Redaction

Sensitive fields are replaced with `[REDACTED]` before reaching any sink:

```typescript
logging: {
  redactFields: ['password', 'token', 'secret', 'authorization', 'cookie'],
}
```

Redaction is recursive (handles nested objects) and case-insensitive.

## CodeCall Audit Events

If `CodeCallPlugin` is installed, it emits a structured audit event at every meaningful point in a
script execution. The plugin registers the bridge itself, so the events reach your normal log
output at `info` under the `codecall:audit` prefix with no wiring.

Event families, all carrying `executionId` for correlation:

- `codecall:execution:start` / `:success` / `:failure` / `:timeout`
- `codecall:tool:call:start` / `:success` / `:failure`
- `codecall:security:self-reference` / `:access-denied` / `:ast-blocked`
- `codecall:search:performed` / `codecall:describe:performed` / `codecall:invoke:performed`

No event carries script source, tool arguments, tool results, or query text — a script is reduced
to `scriptHash` + `scriptLength`, a query to `queryLength`. Do not add those fields when building
on this; the omission is what makes the events safe to emit at `info`.

To route events elsewhere, subscribe rather than parsing logs:

```typescript
const audit = scope.providers.get(AuditLoggerService);
const unsubscribe = audit.subscribe((event) => myShipper.send(event));
```

Fan-out is synchronous and on the execution hot path — hand off to a queue, never do network I/O
inside the listener. Note the file transport writes only the message, so structured fields are
dropped there; use the structured transport or subscribe directly.

## Examples

| Example                                                                        | Level        | Description                                                                                                                    |
| ------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| [`stdout-logging`](../examples/structured-logging/stdout-logging.md)           | Basic        | Enable NDJSON structured logging to stdout with automatic trace correlation and field redaction.                               |
| [`winston-integration`](../examples/structured-logging/winston-integration.md) | Intermediate | Forward FrontMCP structured log entries to your existing winston logger. Each entry includes trace_id and span_id as metadata. |

> See all examples in [`examples/structured-logging/`](../examples/structured-logging/)

## Reference

- [Observability Guide](https://docs.agentfront.dev/frontmcp/guides/observability)
- Related skills: `frontmcp-observability`, `frontmcp-production-readiness`
