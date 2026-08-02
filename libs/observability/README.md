# @frontmcp/observability

OpenTelemetry instrumentation, structured JSON logging, and Prometheus metrics
for FrontMCP servers.

[![NPM](https://img.shields.io/npm/v/@frontmcp/observability.svg)](https://www.npmjs.com/package/@frontmcp/observability)

## What you get

Install the plugin and every MCP request produces a trace span, a structured log
line, and counters — without touching your tool code.

- **Traces** — W3C trace context propagated across the request pipeline, with
  MCP-specific span attributes (tool name, session, transport, RPC method).
- **Logs** — one structured JSON object per request; ready for Datadog, Loki,
  CloudWatch, or anything that reads JSON from stdout.
- **Metrics** — counters and gauges exposed in Prometheus or JSON format.
- **Process stats** — memory, event-loop lag, and uptime.

## Install

```bash
npm install @frontmcp/observability
```

## Usage

```ts
import { ObservabilityPlugin } from '@frontmcp/observability';
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  plugins: [ObservabilityPlugin],
})
class Server {}
```

### Configure

```ts
plugins: [
  ObservabilityPlugin.configure({
    logging: { level: 'info', includeRequestBody: false },
    otel: { serviceName: 'my-server', endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT },
  }),
];
```

<!-- prettier-ignore -->
> Do not log request bodies in production unless you have reviewed them for PII —
> tool arguments frequently carry user data.

## Exposing metrics

```ts
import { PROMETHEUS_CONTENT_TYPE, renderPrometheusExposition } from '@frontmcp/observability';

http: {
  routes: [
    {
      method: 'GET',
      path: '/metrics',
      handler: (_req, res) => {
        res.setHeader('Content-Type', PROMETHEUS_CONTENT_TYPE);
        res.status(200).send(renderPrometheusExposition());
      },
    },
  ];
}
```

`renderJsonExposition()` returns the same data as JSON when you would rather
scrape structured output.

<!-- prettier-ignore -->
> `/metrics` is unauthenticated in the snippet above. Bind it to an internal
> interface, or put it behind auth, before exposing the server publicly.

## Key exports

| Export                                               | Purpose                                             |
| ---------------------------------------------------- | --------------------------------------------------- |
| `ObservabilityPlugin`                                | The plugin — add it to `plugins: []`                |
| `setupOTel`                                          | Wire an OTel SDK yourself instead of via the plugin |
| `FrontMcpPropagator`                                 | W3C trace-context propagator for FrontMCP contexts  |
| `McpAttributes`, `RpcAttributes`, `HttpAttributes`   | Semantic-convention attribute keys                  |
| `renderPrometheusExposition`, `renderJsonExposition` | Metrics rendering                                   |
| `ProcessStatsCollector`                              | Memory / event-loop / uptime sampling               |
| `reportStartup`                                      | Emit a structured boot record                       |

## Trace context over MCP

Protocol revision `2026-07-28` carries OpenTelemetry context in the request
`_meta` (`traceparent`, `tracestate`, `baggage`) per SEP-414, and FrontMCP echoes
it back on the result. A client can therefore stitch its span to the server's
without an out-of-band correlation id — see the
[protocol versions guide](https://docs.agentfront.dev/frontmcp/fundamentals/protocol-versions).

Full guide: [Observability](https://docs.agentfront.dev/frontmcp/features/observability)
&middot; [Metrics](https://docs.agentfront.dev/frontmcp/deployment/metrics)

## License

Apache-2.0
