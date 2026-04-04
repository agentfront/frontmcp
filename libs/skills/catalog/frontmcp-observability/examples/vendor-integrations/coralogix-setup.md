---
name: coralogix-setup
reference: vendor-integrations
level: intermediate
description: 'Send both traces and structured logs to Coralogix. Logs include trace_id so Coralogix links them to traces automatically.'
tags: [coralogix, otlp, vendor, integration, production]
features:
  - 'Traces and logs both sent to Coralogix via OTLP'
  - 'Automatic trace_id correlation — click a trace, see its logs'
  - 'Environment variable configuration for production'
---

# Coralogix Setup

Send both traces and structured logs to Coralogix. Logs include trace_id so Coralogix links them to traces automatically.

## Code

```typescript
// src/server.ts
import { FrontMcp } from '@frontmcp/sdk';
import { setupOTel } from '@frontmcp/observability';

// Traces → Coralogix via OTLP
setupOTel({
  serviceName: 'my-mcp-server',
  exporter: 'otlp',
  endpoint: 'https://ingress.coralogix.com:443', // EU: eu2.coralogix.com
  serviceVersion: '1.0.0',
});

@FrontMcp({
  info: { name: 'my-mcp-server', version: '1.0.0' },
  apps: [MyApp],
  observability: {
    tracing: true,
    logging: {
      sinks: [
        // Logs → Coralogix via OTLP
        {
          type: 'otlp',
          endpoint: 'https://ingress.coralogix.com:443',
          headers: { Authorization: `Bearer ${process.env.CX_PRIVATE_KEY}` },
          serviceName: 'my-mcp-server',
        },
        // Also stdout for Docker log collection
        { type: 'stdout' },
      ],
      redactFields: ['password', 'token', 'secret'],
    },
    requestLogs: true,
  },
})
export default class Server {}
```

Environment variables alternative:

```bash
OTEL_SERVICE_NAME=my-mcp-server
OTEL_EXPORTER_OTLP_ENDPOINT=https://ingress.coralogix.com:443
CX_PRIVATE_KEY=your-coralogix-private-key
```

## What This Demonstrates

- Traces and logs both sent to Coralogix via OTLP
- Automatic trace_id correlation — click a trace, see its logs
- Environment variable configuration for production

## Related

- See `vendor-integrations` for Datadog, Logz.io, Grafana setup
- See `tracing-setup` for trace configuration options
