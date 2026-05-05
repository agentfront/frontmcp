---
name: testing-observability
description: 'Test that your spans, log entries, and telemetry instrumentation work correctly.'
tags: [testing, spans, assertions, integration, jest]
---

# Testing Observability

Verify that your tools create the right spans, log entries include trace context, and custom telemetry produces the expected output.

## Test Utilities

```typescript
import {
  assertSpanAttribute,
  assertSpanExists,
  createTestTracer,
  findSpan,
  findSpansByAttribute,
  getFinishedSpans,
} from '@frontmcp/observability';
```

## Testing Custom Spans

```typescript
describe('AnalyzeDataTool', () => {
  const { tracer, exporter, cleanup } = createTestTracer();

  afterEach(() => exporter.reset());
  afterAll(() => cleanup());

  it('should create a fetch-dataset child span', async () => {
    // ... invoke tool ...

    const spans = getFinishedSpans(exporter);
    const fetchSpan = assertSpanExists(spans, 'fetch-dataset');
    assertSpanAttribute(fetchSpan, 'dataset.id', 'ds-123');
  });

  it('should record error on span when API fails', async () => {
    // ... invoke tool that fails ...

    const spans = getFinishedSpans(exporter);
    const span = findSpan(spans, 'fetch-dataset');
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
  });
});
```

## Testing Log Entries

Use a `CallbackSink` to capture structured log entries:

```typescript
import { CallbackSink, StructuredLogTransport, type StructuredLogEntry } from '@frontmcp/observability';

describe('Structured logging', () => {
  it('should include trace_id in log entries', () => {
    const entries: StructuredLogEntry[] = [];
    const sink = new CallbackSink((e) => entries.push(e));

    const transport = new StructuredLogTransport([sink], {}, () => ({
      requestId: 'req-001',
      traceContext: { traceId: 'a'.repeat(32), parentId: 'b'.repeat(16), traceFlags: 1 },
      sessionIdHash: 'hash12345678',
      scopeId: 'test',
      elapsed: 0,
    }));

    transport.log({
      level: 2,
      levelName: 'info',
      message: 'test message',
      args: [{ userId: 123 }],
      timestamp: new Date(),
      prefix: 'MyTool',
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].trace_id).toBe('a'.repeat(32));
    expect(entries[0].attributes).toEqual({ userId: 123 });
  });
});
```

## Testing Auto-Instrumentation End-to-End

The plugin's hook functions are not part of the public API surface — only top-level helpers from `@frontmcp/observability` are. To verify auto-instrumentation, drive a real tool through the SDK with an isolated tracer and assert spans on the exporter:

```typescript
import { trace } from '@opentelemetry/api';

import { createTestTracer, findSpan, getFinishedSpans } from '@frontmcp/observability';

// ...your test harness for invoking a FrontMCP tool, e.g. via the SDK's
// in-process server or your transport adapter under test.

it('should create RPC + tool spans for a tool call', async () => {
  const { tracer, exporter, cleanup } = createTestTracer();
  // Register the tracer for the duration of the test so the plugin's hooks
  // see a TracerProvider (without it, all OTel calls are no-ops).
  trace.setGlobalTracerProvider(tracer);

  try {
    // Drive a real tool call through your server / harness.
    await invokeTool('my_tool', {
      /* args */
    });

    const spans = getFinishedSpans(exporter);
    expect(findSpan(spans, 'tools/call')).toBeTruthy();
    expect(findSpan(spans, 'tool my_tool')).toBeTruthy();
  } finally {
    cleanup();
  }
});
```

Use `createTestTracer()` (top-level import from `@frontmcp/observability`) — never reach into internal hook subpaths, which are not part of the package's `exports` map.

## Test Isolation

Each test should:

1. Call `exporter.reset()` in `beforeEach` to clear previous spans
2. Call `cleanup()` in `afterAll` to shut down the provider
3. Use `createTestTracer()` which does NOT register globally (safe for parallel tests)

## API Reference

| Function                                  | Purpose                                             |
| ----------------------------------------- | --------------------------------------------------- |
| `createTestTracer(name?)`                 | Create isolated tracer + exporter (not global)      |
| `getFinishedSpans(exporter)`              | Get all exported spans                              |
| `assertSpanExists(spans, name)`           | Assert span exists, return it (throws if not found) |
| `assertSpanAttribute(span, key, value)`   | Assert attribute value on a span                    |
| `findSpan(spans, name)`                   | Find span by name (returns undefined if not found)  |
| `findSpansByAttribute(spans, key, value)` | Find all spans with matching attribute              |

## Examples

| Example                                                                             | Level        | Description                                                                                 |
| ----------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------- |
| [`test-custom-spans`](../examples/testing-observability/test-custom-spans.md)       | Basic        | Verify that your tool creates the expected child spans with correct attributes.             |
| [`test-log-correlation`](../examples/testing-observability/test-log-correlation.md) | Intermediate | Verify that structured log entries include trace context fields for correlation with spans. |

> See all examples in [`examples/testing-observability/`](../examples/testing-observability/)

## Reference

- [Telemetry API Reference](https://docs.agentfront.dev/frontmcp/sdk-reference/telemetry)
- Related skills: `frontmcp-testing`, `frontmcp-observability`
