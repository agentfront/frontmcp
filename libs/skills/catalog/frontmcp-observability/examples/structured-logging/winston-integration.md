---
name: winston-integration
reference: structured-logging
level: intermediate
description: 'Forward FrontMCP structured log entries to your existing winston logger. Each entry includes trace_id and span_id as metadata.'
tags: [logging, winston, integration, intermediate]
features:
  - 'WinstonSink forwarding structured entries with trace metadata'
  - 'Multiple sinks running simultaneously (stdout + winston)'
  - 'Winston transports handle file logging, remote forwarding, etc.'
---

# Winston Integration

Forward FrontMCP structured log entries to your existing winston logger. Each entry includes trace_id and span_id as metadata.

## Code

```typescript
// src/server.ts
import { FrontMcp } from '@frontmcp/sdk';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console(), new winston.transports.File({ filename: 'app.log' })],
});

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  observability: {
    tracing: true,
    logging: {
      sinks: [
        { type: 'winston', logger }, // Forward to winston
        { type: 'stdout' }, // Also write NDJSON to stdout
      ],
    },
  },
})
export default class Server {}
```

Winston receives entries like:

```json
{
  "level": "info",
  "message": "tool executed",
  "timestamp": "2026-04-03T10:15:30.123Z",
  "trace_id": "abcdef1234567890abcdef1234567890",
  "span_id": "1234567890abcdef",
  "request_id": "req-001",
  "session_id_hash": "a3f8b2c1d4e5f6a7",
  "attributes": { "tool": "get_weather", "duration_ms": 142 }
}
```

## What This Demonstrates

- WinstonSink forwarding structured entries with trace metadata
- Multiple sinks running simultaneously (stdout + winston)
- Winston transports handle file logging, remote forwarding, etc.

## Related

- See `structured-logging` for all sink types
- See `vendor-integrations` for connecting to Coralogix/Datadog via winston
