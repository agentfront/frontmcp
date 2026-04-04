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

For traces, configure `setupOTel()` with the same endpoint:

```typescript
import { setupOTel } from '@frontmcp/observability';

setupOTel({
  serviceName: 'my-mcp-server',
  exporter: 'otlp',
  endpoint: 'https://ingress.coralogix.com:443',
});
```

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
