---
name: stdout-logging
reference: structured-logging
level: basic
description: 'Enable NDJSON structured logging to stdout with automatic trace correlation and field redaction.'
tags: [logging, stdout, ndjson, redaction, basic]
features:
  - 'NDJSON format for stdout (Docker/K8s log collection)'
  - 'Automatic trace context enrichment (trace_id, span_id)'
  - 'Sensitive field redaction (token → [REDACTED])'
---

# Stdout Structured Logging

Enable NDJSON structured logging to stdout with automatic trace correlation and field redaction.

## Code

```typescript
// src/server.ts
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'my-server', version: '1.0.0' },
  apps: [MyApp],
  observability: {
    tracing: true,
    logging: {
      sinks: [{ type: 'stdout' }],
      redactFields: ['password', 'token', 'secret', 'authorization'],
      includeStacks: process.env.NODE_ENV !== 'production',
    },
  },
})
export default class Server {}
```

```typescript
// In any tool:
this.logger.info('user authenticated', { userId: 'u-123', token: 'secret-jwt' });
```

Output (NDJSON, one line per entry):

```json
{
  "timestamp": "2026-04-03T10:15:30.123Z",
  "level": "info",
  "severity_number": 9,
  "message": "user authenticated",
  "trace_id": "abcdef...",
  "span_id": "123456...",
  "request_id": "req-001",
  "session_id_hash": "a3f8b2c1d4e5f6a7",
  "scope_id": "my-app",
  "flow_name": "tools:call-tool",
  "elapsed_ms": 42,
  "prefix": "MyTool",
  "attributes": { "userId": "u-123", "token": "[REDACTED]" }
}
```

## What This Demonstrates

- NDJSON format for stdout (Docker/K8s log collection)
- Automatic trace context enrichment (trace_id, span_id)
- Sensitive field redaction (token → [REDACTED])

## Related

- See `structured-logging` for all sink types
