---
name: test-log-correlation
reference: testing-observability
level: intermediate
description: 'Verify that structured log entries include trace context fields for correlation with spans.'
tags: [testing, logging, correlation, trace-id, intermediate]
features:
  - 'CallbackSink captures log entries for test assertions'
  - 'StructuredLogTransport with mock context accessor provides trace fields'
  - 'Verifying trace_id, span_id, request_id are present'
  - 'Testing field redaction behavior'
---

# Test Log Correlation

Verify that structured log entries include trace context fields for correlation with spans.

## Code

```typescript
// src/__tests__/log-correlation.spec.ts
import { StructuredLogTransport, CallbackSink } from '@frontmcp/observability';
import type { StructuredLogEntry } from '@frontmcp/observability';

describe('Log correlation', () => {
  it('should include trace_id and request_id in log entries', () => {
    const entries: StructuredLogEntry[] = [];
    const sink = new CallbackSink((e) => entries.push(e));

    const transport = new StructuredLogTransport([sink], {}, () => ({
      requestId: 'req-test-001',
      traceContext: {
        traceId: 'a'.repeat(32),
        parentId: 'b'.repeat(16),
        traceFlags: 1,
      },
      sessionIdHash: 'hash12345678',
      scopeId: 'test-scope',
      flowName: 'tools:call-tool',
      elapsed: 100,
    }));

    transport.log({
      level: 2,
      levelName: 'info',
      message: 'tool executed',
      args: [{ toolName: 'get_weather', duration: 142 }],
      timestamp: new Date(),
      prefix: 'MyTool',
    });

    expect(entries).toHaveLength(1);
    const entry = entries[0];

    // Trace correlation
    expect(entry.trace_id).toBe('a'.repeat(32));
    expect(entry.span_id).toBe('b'.repeat(16));
    expect(entry.request_id).toBe('req-test-001');
    expect(entry.session_id_hash).toBe('hash12345678');
    expect(entry.scope_id).toBe('test-scope');
    expect(entry.flow_name).toBe('tools:call-tool');
    expect(entry.elapsed_ms).toBe(100);

    // Structured attributes
    expect(entry.attributes).toEqual({
      toolName: 'get_weather',
      duration: 142,
    });
  });

  it('should redact sensitive fields', () => {
    const entries: StructuredLogEntry[] = [];
    const sink = new CallbackSink((e) => entries.push(e));
    const transport = new StructuredLogTransport([sink], { redactFields: ['password', 'apiKey'] });

    transport.log({
      level: 2,
      levelName: 'info',
      message: 'auth attempt',
      args: [{ user: 'alice', password: 'secret', apiKey: 'sk-123' }],
      timestamp: new Date(),
      prefix: '',
    });

    expect(entries[0].attributes).toEqual({
      user: 'alice',
      password: '[REDACTED]',
      apiKey: '[REDACTED]',
    });
  });
});
```

## What This Demonstrates

- CallbackSink captures log entries for test assertions
- StructuredLogTransport with mock context accessor provides trace fields
- Verifying trace_id, span_id, request_id are present
- Testing field redaction behavior

## Related

- See `testing-observability` for span testing patterns
- See `structured-logging` for sink configuration
