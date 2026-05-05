---
name: vendor-integrations
description: 'Connect FrontMCP observability to Coralogix, Datadog, Logz.io, Grafana Cloud, or any OTLP backend.'
tags: [vendor, coralogix, datadog, logz, grafana, otlp, integration]
---

# Vendor Integrations

Connect FrontMCP traces and logs to any monitoring platform. All major vendors accept OTLP — the standard OpenTelemetry protocol.

## OTLP — Universal Standard

The `otlp` sink type sends structured logs (with trace correlation) to any OTLP-compatible endpoint:

```typescript
@FrontMcp({
  observability: {
    tracing: true,
    logging: {
      sinks: [{
        type: 'otlp',
        endpoint: 'http://your-collector:4318',
        headers: { Authorization: 'Bearer YOUR_TOKEN' },
      }],
    },
  },
})
```

## Vendor-Specific Configuration

### Coralogix

```typescript
observability: {
  tracing: true,
  logging: {
    sinks: [{
      type: 'otlp',
      endpoint: 'https://ingress.coralogix.com:443',    // EU: eu2.coralogix.com
      headers: { Authorization: 'Bearer CX_PRIVATE_KEY' },
      serviceName: 'my-mcp-server',
    }],
  },
}
```

For traces, configure `setupOTel()` with the same endpoint. `setupOTel()` does **not** accept `headers` directly — pass auth via the standard `OTEL_EXPORTER_OTLP_HEADERS` environment variable, which the underlying OTLP trace exporter reads automatically:

```typescript
import { setupOTel } from '@frontmcp/observability';

setupOTel({
  serviceName: 'my-mcp-server',
  exporter: 'otlp',
  endpoint: 'https://ingress.coralogix.com:443',
});
```

```bash
# Auth is supplied via env var, not setupOTel options
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer ${CX_PRIVATE_KEY}"
```

> The OTLP **logging** sink (`{ type: 'otlp', headers: { ... } }`) does accept `headers` directly — only `setupOTel()` for traces relies on env vars.

### Datadog

```typescript
observability: {
  tracing: true,
  logging: {
    sinks: [{
      type: 'otlp',
      endpoint: 'https://http-intake.logs.datadoghq.com',  // EU: .datadoghq.eu
      headers: { 'DD-API-KEY': 'YOUR_DATADOG_API_KEY' },
    }],
  },
}
```

### Logz.io

```typescript
observability: {
  tracing: true,
  logging: {
    sinks: [{
      type: 'otlp',
      endpoint: 'https://otlp-listener.logz.io:8071',
      headers: { Authorization: 'Bearer YOUR_SHIPPING_TOKEN' },
    }],
  },
}
```

### Grafana Cloud

```typescript
observability: {
  tracing: true,
  logging: {
    sinks: [{
      type: 'otlp',
      endpoint: 'https://otlp-gateway-prod-us-east-0.grafana.net/otlp',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${instanceId}:${apiKey}`).toString('base64'),
      },
    }],
  },
}
```

### Local Collector (Development)

```typescript
observability: {
  tracing: true,
  logging: {
    sinks: [{ type: 'otlp', endpoint: 'http://localhost:4318' }],
  },
}
```

## Environment Variable Configuration

All vendors can be configured via environment variables — no code changes:

```bash
OTEL_SERVICE_NAME=my-mcp-server
OTEL_EXPORTER_OTLP_ENDPOINT=https://ingress.coralogix.com:443
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer CX_KEY"
```

## Winston / Pino (Existing Logging)

If you already have a winston or pino setup routing logs to a vendor:

```typescript
// Use your existing logger — it already sends to your vendor
observability: {
  logging: {
    sinks: [{ type: 'winston', logger: existingWinstonLogger }],
  },
}
```

Structured log entries (with `trace_id`) are forwarded to your logger, which sends them to wherever it's configured.

## Exporting Metrics (Counters)

Counters created by `this.telemetry.createCounter(...)` and the built-in framework counters (`frontmcp_skills_bundle_pulls_total`, `frontmcp_skills_signature_failures_total`, `frontmcp_skills_replay_rejects_total`, etc.) become observable once you register a global OTel `MeterProvider`. Mirror your trace setup with `@opentelemetry/sdk-metrics` and an OTLP metric exporter:

```typescript
import { metrics } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

const meterProvider = new MeterProvider({
  resource: new Resource({ 'service.name': 'my-mcp-server' }),
  readers: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/metrics',
      }),
      exportIntervalMillis: 10_000,
    }),
  ],
});

metrics.setGlobalMeterProvider(meterProvider);
```

Use the same vendor-specific endpoint for metrics that you use for traces (most vendors accept both on a single OTLP gateway):

| Vendor        | Metrics endpoint hint                                                           |
| ------------- | ------------------------------------------------------------------------------- |
| Coralogix     | `https://ingress.coralogix.com:443` — auth via `OTEL_EXPORTER_OTLP_HEADERS`     |
| Datadog       | Use the Datadog OTLP intake (`/api/v2/otlp/v1/metrics`) with `DD-API-KEY`       |
| Grafana Cloud | `https://otlp-gateway-<region>.grafana.net/otlp/v1/metrics` (Basic auth)        |
| Logz.io       | Use the dedicated Metrics token endpoint (`https://otlp-listener.logz.io:8053`) |

Without a registered `MeterProvider`, counters still increment in an in-memory snapshot (readable via `getMetricSnapshot()` from `@frontmcp/observability`) but are **not** exported. Use the snapshot for tests and local debugging only.

## OTLP Sink Options

| Option            | Type                     | Default                                                  | Description                                 |
| ----------------- | ------------------------ | -------------------------------------------------------- | ------------------------------------------- |
| `endpoint`        | `string`                 | `OTEL_EXPORTER_OTLP_ENDPOINT` or `http://localhost:4318` | OTLP endpoint (path `/v1/logs` is appended) |
| `headers`         | `Record<string, string>` | `{}`                                                     | Auth headers                                |
| `batchSize`       | `number`                 | `100`                                                    | Max entries before auto-flush               |
| `flushIntervalMs` | `number`                 | `5000`                                                   | Flush timer interval                        |
| `serviceName`     | `string`                 | `OTEL_SERVICE_NAME` or `frontmcp-server`                 | Service name in resource attributes         |

## Examples

| Example                                                                 | Level        | Description                                                                                                               |
| ----------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| [`coralogix-setup`](../examples/vendor-integrations/coralogix-setup.md) | Intermediate | Send both traces and structured logs to Coralogix. Logs include trace_id so Coralogix links them to traces automatically. |

> See all examples in [`examples/vendor-integrations/`](../examples/vendor-integrations/)

## Reference

- [Observability Guide](https://docs.agentfront.dev/frontmcp/guides/observability)
- Related skills: `frontmcp-deployment`, `frontmcp-production-readiness`
