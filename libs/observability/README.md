# @frontmcp/observability

OpenTelemetry tracing, structured JSON logs, per-request log objects and counters for FrontMCP servers. Turn it on with `@FrontMcp({ observability })`: each request gets a span, and so does each tool call, resource read and prompt it serves, with no change to your tool code. It also holds the counters and the Prometheus serializer behind the `/metrics` endpoint that `@FrontMcp({ metrics })` serves.

[![npm](https://img.shields.io/npm/v/@frontmcp/observability.svg)](https://www.npmjs.com/package/@frontmcp/observability) [![License](https://img.shields.io/npm/l/@frontmcp/observability.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

```bash
npm install @frontmcp/observability @opentelemetry/sdk-trace-base
```

Requires Node.js 24 or later, and `@frontmcp/sdk` in the app (a peer dependency, as is `@frontmcp/utils`, which comes with the SDK). `@opentelemetry/api` is installed with the package.

`@opentelemetry/sdk-trace-base` is listed as an optional peer, but the package loads it as soon as it's imported, so install it.

The other optional peers each enable one thing:

| Package                                   | Enables                                                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `@opentelemetry/sdk-node`                 | `setupOTel()`, which also needs `@opentelemetry/resources` and `@opentelemetry/semantic-conventions`                          |
| `@opentelemetry/exporter-trace-otlp-http` | Sending spans to an OpenTelemetry collector over OTLP (the OpenTelemetry protocol), such as `setupOTel({ exporter: 'otlp' })` |
| `pino`, `winston`                         | The `pino` and `winston` log sinks, which write to a logger you create                                                        |

## Usage

```ts
import { createCounter, type RequestLog } from '@frontmcp/observability';
import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

const ticketsClosed = createCounter('helpdesk_tickets_closed_total', 'Tickets closed');

@Tool({ name: 'close_ticket', description: 'Close a support ticket', inputSchema: { id: z.string() } })
class CloseTicket extends ToolContext {
  async execute({ id }: { id: string }) {
    await this.telemetry.withSpan('tickets.close', async (span) => {
      span.setAttribute('ticket.id', id);
    });
    ticketsClosed.inc();
    return { id, status: 'closed' };
  }
}

@App({ id: 'help-desk', name: 'Help Desk', tools: [CloseTicket] })
class HelpDeskApp {}

@FrontMcp({
  info: { name: 'help-desk', version: '1.0.0' },
  apps: [HelpDeskApp],
  observability: {
    tracing: true,
    logging: { sinks: [{ type: 'stdout' }], redactFields: ['password', 'token', 'authorization'] },
    requestLogs: {
      onRequestComplete: (entry) => {
        const log = entry as RequestLog;
        if (log.status === 'error') console.error(log.request_id, log.error);
      },
    },
  },
  metrics: { enabled: true, auth: 'token' }, // GET /metrics, with the bearer token in FRONTMCP_METRICS_TOKEN
})
export default class Server {}
```

- **Spans** follow each request: `POST /` (or your entry path), then `tools/call`, then `tool close_ticket`, with your `tickets.close` span inside it and a client span for each outbound `this.fetch()`. They carry MCP attributes such as `mcp.method.name`, `frontmcp.tool.name` and a hash of the session id, never the id itself.
- **Logs**: each line of the server's log becomes one JSON object with the request's trace and request ids, sent to every sink in `logging.sinks`.
- **Request logs**: `onRequestComplete` gets one object per HTTP request, with its timing, what it called, its status and error, and the log lines written during it.
- **Metrics**: `/metrics` serves process gauges (memory, CPU, event-loop lag) and every counter, in the Prometheus text format, or JSON with `format: 'json'`.

`@FrontMcp({ observability: true })` turns on tracing alone. Without the package installed, a server with `observability` starts anyway and logs one warning; a server with `metrics.enabled` doesn't start.

### Sending spans somewhere

The plugin records spans through OpenTelemetry's global tracer provider, and FrontMCP doesn't register one for you (in development it prints each span to the console). Register a provider before the server handles requests. `setupOTel()` does it with OpenTelemetry's Node SDK:

```ts
import { setupOTel } from '@frontmcp/observability';

const shutdown = setupOTel({ serviceName: 'help-desk', exporter: 'otlp', endpoint: 'http://localhost:4318' });
```

`exporter` is `'console'` (the default) or `'otlp'`, which sends to `endpoint` plus `/v1/traces`. `endpoint` defaults to `OTEL_EXPORTER_OTLP_ENDPOINT`, then `http://localhost:4318`, and `serviceName` to `OTEL_SERVICE_NAME`, then `'frontmcp-server'`. Call the function it returns to flush and stop the provider. Any other OpenTelemetry setup that registers a global tracer provider works too.

### Options

| Option        | Type                                                              | Default | Description                                                                                   |
| ------------- | ----------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| `tracing`     | `boolean \| TracingOptions`                                       | `true`  | Spans for requests and calls, and `this.telemetry` in tools, resources and prompts            |
| `logging`     | `boolean \| { sinks, redactFields, includeStacks, staticFields }` | `false` | Structured log entries, sent to `sinks`. `logging: true` has no sinks and writes nothing      |
| `requestLogs` | `boolean \| { maxEntries, includeSummaries, onRequestComplete }`  | `false` | One object per HTTP request, passed to `onRequestComplete`. `includeSummaries` isn't read yet |

`TracingOptions` turns span groups on or off: `httpSpans`, `executionSpans`, `fetchSpans`, `transportSpans`, `authSpans`, `oauthSpans`, `elicitationSpans`, `flowStageEvents` and `startupReport` default to `true`, and `hookSpans` (a span for each hook, verbose) to `false`.

The log sinks are `{ type: 'stdout', pretty? }` (one JSON object per line), `{ type: 'console' }` (a readable line), `{ type: 'callback', fn }`, `{ type: 'otlp', endpoint?, headers?, batchSize?, flushIntervalMs?, serviceName? }`, `{ type: 'pino', logger }` and `{ type: 'winston', logger }`.

`@FrontMcp({ observability })` registers `ObservabilityPlugin` for you. You can register `ObservabilityPlugin.init(options)` in `plugins` yourself, but `observability` also connects the `logging` sinks to the server's logger, which the plugin alone doesn't.

## Key exports

| Export                                                                                                                      | Purpose                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `ObservabilityPlugin`                                                                                                       | The plugin that `observability` loads                                                                      |
| `setupOTel`                                                                                                                 | Register a tracer provider through OpenTelemetry's Node SDK                                                |
| `createCounter`, `getMetricSnapshot`, `getCounterTotal`, `resetMetricSnapshot`                                              | Counters for `/metrics` (and a global OpenTelemetry meter, if you register one), and reading them in tests |
| `renderPrometheusExposition(counters, gauges?)`, `renderJsonExposition`, `PROMETHEUS_CONTENT_TYPE`                          | Serialize a counter snapshot for an endpoint of your own                                                   |
| `ProcessStatsCollector`                                                                                                     | Process gauges: CPU, memory, uptime, event-loop lag, active handles, open file descriptors                 |
| `StructuredLogTransport`, `createSinks`, `StdoutSink`, `ConsoleSink`, `CallbackSink`, `OtlpSink`, `PinoSink`, `WinstonSink` | Structured logging building blocks                                                                         |
| `McpAttributes`, `FrontMcpAttributes`, `RpcAttributes`, `HttpAttributes`, `EnduserAttributes`                               | Span attribute names                                                                                       |
| `FrontMcpPropagator`, `withSpan`, `startSpan`, `startToolSpan`, ...                                                         | Lower-level span helpers                                                                                   |
| `createTestTracer`, `getFinishedSpans`, `assertSpanExists`, `assertSpanAttribute`, `findSpan`                               | Collect spans in memory and check them in a test                                                           |

## Trace context over MCP

On protocol revision `2026-07-28`, a client may send `traceparent`, `tracestate` and `baggage` in a request's `_meta`, and FrontMCP copies them to the result's `_meta`. To put the server's spans in the client's trace, send the W3C `traceparent` HTTP header. See [protocol versions](https://frontmcp.dev/reference/server/protocol-versions).

## Docs

- [Observability and telemetry](https://frontmcp.dev/reference/server/observability): every option, the spans a call records, `this.telemetry`, structured logs, request logs and counters
- [Health checks and metrics](https://frontmcp.dev/reference/deployment/health-and-metrics): `/metrics`, `/healthz` and `/readyz`, and scraping with Prometheus
- [Logging](https://frontmcp.dev/reference/server/logging): the server's own log, which `logging` sinks receive

## Related packages

- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk): the framework; its `observability` and `metrics` options load this package
- [`@frontmcp/testing`](https://www.npmjs.com/package/@frontmcp/testing): end-to-end tests for a FrontMCP server

## Contributing

Source: [`libs/observability`](https://github.com/agentfront/frontmcp/tree/main/libs/observability). Issues and pull requests are welcome; see [CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
