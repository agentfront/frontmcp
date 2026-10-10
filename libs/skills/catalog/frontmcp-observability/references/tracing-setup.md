---
name: tracing-setup
description: 'Enable OpenTelemetry distributed tracing for all FrontMCP flows with zero configuration.'
tags: [tracing, opentelemetry, spans, setup]
---

# Tracing Setup

Enable automatic distributed tracing for every flow in your FrontMCP server. When enabled, hooks across all SDK flows produce spans (and stage events on those spans) for tool calls, resource reads, HTTP requests, auth flows, transport sessions, and more — with zero code changes.

## How It Works

1. Set `observability: true` in `@FrontMcp` config
2. The SDK auto-loads `@frontmcp/observability` and registers hooks on all SDK flows
3. Every request gets a single W3C trace ID, shared across all spans
4. Without a TracerProvider, all OTel calls are no-ops (zero overhead)

## Enable Tracing

```typescript
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  observability: true,
})
export default class Server {}
```

## Configure a TracerProvider

Spans only appear when a TracerProvider is configured. Three ways:

### Option A: setupOTel() convenience

```typescript
import { setupOTel } from '@frontmcp/observability';

// Call BEFORE @FrontMcp decorator runs
setupOTel({
  serviceName: 'my-server',
  exporter: 'otlp',
  endpoint: 'http://localhost:4318',
});
```

### Option B: Environment variables

```bash
OTEL_SERVICE_NAME=my-server \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
node server.js
```

### Option C: Your own OTel SDK

```typescript
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' }),
});
sdk.start();
```

## Span Hierarchy

Every request produces a span tree:

```
HTTP Server Span: "POST /mcp"
  ├── event: stage.traceRequest
  ├── event: stage.checkAuthorization
  ├── event: stage.router
  │
  ├── RPC Span: "tools/call"
  │     ├── rpc.system = "mcp"
  │     ├── mcp.session.id = "a3f8..."
  │     ├── event: stage.parseInput
  │     ├── event: stage.findTool
  │     ├── event: stage.validateInput
  │     │
  │     ├── Tool Span: "tool get_weather"
  │     │     ├── mcp.component.type = "tool"
  │     │     ├── enduser.id = "client-42"
  │     │     ├── event: stage.execute.start
  │     │     ├── event: stage.execute.done
  │     │
  │     ├── event: stage.validateOutput
  │     └── event: stage.finalize
  │
  └── event: stage.finalize
```

## Fine-Grained Control

```typescript
observability: {
  tracing: {
    httpSpans: true,           // HTTP request spans
    executionSpans: true,      // Tool/resource/prompt/agent spans
    fetchSpans: true,          // Outbound ctx.fetch() spans
    flowStageEvents: true,     // Add stage events (e.g. stage.execute.start) on the parent span
    transportSpans: true,      // SSE/HTTP transport spans
    authSpans: true,           // Auth/session verify spans
    oauthSpans: true,          // OAuth flow spans
    elicitationSpans: true,    // Elicitation spans
    hookSpans: false,          // Emit a NEW child span per hook (verbose; default off)
    startupReport: true,       // Emit a frontmcp.startup span once the server is ready
  },
}
```

- A failed call ends its spans with status ERROR and the message the client sees in production, and an `exception` event of the error's code (`PUBLIC_ERROR`), the error `this.fail()` was given included. A plain `Error` (thrown by a hook, say) is recorded as the client receives it: the masked `Internal FrontMCP error. Please contact support with error ID: err_…` message and `SERVER_ERROR`; the request log's `error` is `{ type: 'GenericServerError', message, code: 'SERVER_ERROR', error_id }` with the error ID the client and the server's error log carry.
- ES-module projects (`"type": "module"`) record the same: the SDK's ESM build loads observability's CommonJS build, which brings a second copy of the SDK classes, and `McpError`, `PublicMcpError`, `InternalMcpError`, `FlowControl`, `DynamicPlugin`, `GuardError` and `AuthorityDeniedError` recognise the other copy's instances by a process-wide brand (`instanceof` works across copies; an error keeps one error ID whichever copy converts it). In 1.9.3 an ES-module project recorded every failure as `GenericServerError` with an error ID the client never saw.
- `this.fetch()` in a tool sends a `traceparent` naming its `GET` client span (or, with `fetchSpans: false`, the running span) as the parent, so the service called nests under it. A `traceparent` you set yourself is kept.
- With `NODE_ENV=development` and no TracerProvider registered, FrontMCP registers one that prints each span to the console.

### `flowStageEvents` vs `hookSpans` — what's the difference?

- `flowStageEvents: true` (default) — the plugin's hooks attach **events** (`addEvent('stage.execute.start')`, etc.) onto the existing parent span (e.g. the tool span). One span per request stage; many events per span. Cheap, easy to read.
- `hookSpans: true` (default off) — the plugin emits a **separate child span** (`hook <stage>`, with `frontmcp.hook.owner`) for each hook a plugin, app or entry runs, inside its flow's span. Produces a much deeper, noisier trace and is intended for low-level debugging of the SDK pipeline itself. Most users should leave this off.

In other words: events live inside an existing span; hook spans add their own spans to the tree.

## Local Development

### otel-desktop-viewer

```bash
brew install ymtdzzz/tap/otel-desktop-viewer
otel-desktop-viewer  # UI at :8000, OTLP on :4317
```

### Jaeger

```bash
docker run -d --name jaeger \
  -p 16686:16686 -p 4317:4317 -p 4318:4318 \
  jaegertracing/all-in-one:latest
# UI at http://localhost:16686
```

## Examples

| Example                                                                 | Level        | Description                                                                                            |
| ----------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------ |
| [`basic-tracing`](../examples/tracing-setup/basic-tracing.md)           | Basic        | Enable auto-tracing and see spans printed to your terminal.                                            |
| [`production-tracing`](../examples/tracing-setup/production-tracing.md) | Intermediate | Full production observability — traces to OTLP, structured logs to stdout, per-request log collection. |

> See all examples in [`examples/tracing-setup/`](../examples/tracing-setup/)

## Reference

- [Observability Guide](https://frontmcp.dev/reference/server/observability)
- Related skills: `frontmcp-config`, `frontmcp-deployment`
