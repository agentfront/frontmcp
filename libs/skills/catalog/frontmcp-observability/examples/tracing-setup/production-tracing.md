---
name: production-tracing
reference: tracing-setup
level: intermediate
description: 'Full production observability — traces to OTLP, structured logs to stdout, per-request log collection.'
tags: [tracing, production, otlp, logging, request-logs]
features:
  - 'OTLP exporter with env var configuration'
  - 'Structured logging with sensitive field redaction'
  - 'Request log collection with error alerting'
  - 'Full tracing across all SDK flows'
---

# Production Tracing Setup

Full production observability — traces to OTLP, structured logs to stdout, per-request log collection.

## Code

```typescript
// src/server.ts
import { FrontMcp } from '@frontmcp/sdk';
import { setupOTel } from '@frontmcp/observability';
import { MyApp } from './apps/my-app';

setupOTel({
  serviceName: process.env.OTEL_SERVICE_NAME ?? 'my-server',
  exporter: 'otlp',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://collector:4318',
  serviceVersion: '1.0.0',
});

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  observability: {
    tracing: {
      httpSpans: true,
      executionSpans: true,
      fetchSpans: true,
      flowStageEvents: true,
      transportSpans: true,
      authSpans: true,
    },
    logging: {
      sinks: [{ type: 'stdout' }],
      redactFields: ['password', 'token', 'secret', 'authorization'],
      includeStacks: false,
    },
    requestLogs: {
      maxEntries: 500,
      onRequestComplete: async (log) => {
        if (log.status === 'error') {
          console.error('Request failed:', JSON.stringify(log));
        }
      },
    },
  },
})
export default class Server {}
```

## What This Demonstrates

- OTLP exporter with env var configuration
- Structured logging with sensitive field redaction
- Request log collection with error alerting
- Full tracing across all SDK flows

## Related

- See `tracing-setup` for all configuration options
- See `vendor-integrations` for Coralogix/Datadog/Logz.io setup
