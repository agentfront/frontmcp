---
name: tracing-setup
description: 'Enable OpenTelemetry distributed tracing for all FrontMCP flows with zero configuration.'
tags: [tracing, opentelemetry, spans, setup]
---

# Tracing Setup

Enable automatic distributed tracing for every flow in your FrontMCP server. When enabled, 103+ hooks create spans for tool calls, resource reads, HTTP requests, auth flows, transport sessions, and more — with zero code changes.

## How It Works

1. Set `observability: true` in `@FrontMcp` config
2. The SDK auto-loads `@frontmcp/observability` and registers hooks on all 33 flows
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
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

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
    flowStageEvents: true,     // Flow stage events on execution spans
    transportSpans: true,      // SSE/HTTP transport spans
    authSpans: true,           // Auth/session verify spans
    oauthSpans: true,          // OAuth flow spans
    elicitationSpans: true,    // Elicitation spans
    hookSpans: false,          // Individual hook spans (verbose)
    startupReport: true,       // Emit startup span on first request
  },
}
```

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

- [Observability Guide](https://docs.agentfront.dev/frontmcp/guides/observability)
- Related skills: `frontmcp-config`, `frontmcp-deployment`
