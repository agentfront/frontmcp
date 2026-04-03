import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { diag, DiagLogLevel, SpanStatusCode, trace, context as otelContext } from '@opentelemetry/api';
import { TelemetryAccessor, TelemetrySpan } from '../telemetry/telemetry.accessor';
import { ACTIVE_SPAN_KEY, ACTIVE_OTEL_CTX_KEY } from '../plugin/observability.hooks';

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
diag.setLogger(
  { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, verbose: () => {} },
  DiagLogLevel.NONE,
);
provider.register();
afterAll(async () => {
  await provider.shutdown();
});

function makeCtx() {
  return {
    requestId: 'req-001',
    sessionId: 'session-abc',
    scopeId: 'test-scope',
    traceContext: {
      traceId: 'a'.repeat(32),
      parentId: 'b'.repeat(16),
      traceFlags: 1,
      raw: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
    },
  };
}

describe('TelemetryAccessor', () => {
  beforeEach(() => exporter.reset());

  describe('startSpan', () => {
    it('should create a child span with base attributes', () => {
      const accessor = new TelemetryAccessor(makeCtx());
      const span = accessor.startSpan('my-operation');
      span.end();

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe('my-operation');
      expect(spans[0].attributes['frontmcp.request.id']).toBe('req-001');
      expect(spans[0].attributes['frontmcp.scope.id']).toBe('test-scope');
      expect(spans[0].attributes['mcp.session.id']).toBeTruthy();
    });

    it('should accept initial attributes', () => {
      const accessor = new TelemetryAccessor(makeCtx());
      const span = accessor.startSpan('op', { 'custom.key': 'value' });
      span.end();

      expect(exporter.getFinishedSpans()[0].attributes['custom.key']).toBe('value');
    });

    it('should share trace ID with parent context', () => {
      const accessor = new TelemetryAccessor(makeCtx());
      const span = accessor.startSpan('child');
      span.end();

      expect(exporter.getFinishedSpans()[0].spanContext().traceId).toBe('a'.repeat(32));
    });
  });

  describe('withSpan', () => {
    it('should create span, run fn, end with OK', async () => {
      const accessor = new TelemetryAccessor(makeCtx());
      const result = await accessor.withSpan('auto-span', async (span) => {
        span.addEvent('step-done');
        return 42;
      });

      expect(result).toBe(42);
      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].status.code).toBe(SpanStatusCode.OK);
      expect(spans[0].events).toHaveLength(1);
    });

    it('should end span with ERROR on throw', async () => {
      const accessor = new TelemetryAccessor(makeCtx());
      await expect(
        accessor.withSpan('fail', async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      const spans = exporter.getFinishedSpans();
      expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
    });

    it('should accept attributes', async () => {
      const accessor = new TelemetryAccessor(makeCtx());
      await accessor.withSpan('op', async () => {}, { key: 'val' });

      expect(exporter.getFinishedSpans()[0].attributes['key']).toBe('val');
    });
  });

  describe('addEvent', () => {
    it('should add event to active span when available', () => {
      // Simulate an active span (as set by auto-instrumentation hooks)
      const tracerInstance = provider.getTracer('test');
      const activeSpan = tracerInstance.startSpan('tool my_tool');
      const store = new Map<string | symbol, unknown>();
      store.set(ACTIVE_SPAN_KEY, activeSpan);

      const ctx = {
        ...makeCtx(),
        get: <T>(key: string | symbol): T | undefined => store.get(key) as T | undefined,
      };

      const accessor = new TelemetryAccessor(ctx);
      accessor.addEvent('validation-done', { items: 5 });

      activeSpan.end();

      const spans = exporter.getFinishedSpans();
      const toolSpan = spans.find((s) => s.name === 'tool my_tool');
      expect(toolSpan).toBeTruthy();
      // The event should be ON the tool span, not a separate span
      expect(toolSpan!.events.some((e) => e.name === 'validation-done')).toBe(true);
    });

    it('should fall back to creating child span when no active span', () => {
      const accessor = new TelemetryAccessor(makeCtx());
      accessor.addEvent('cache-hit', { key: 'users' });

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe('cache-hit');
    });

    it('should work without attributes', () => {
      const accessor = new TelemetryAccessor(makeCtx());
      accessor.addEvent('simple-event');

      expect(exporter.getFinishedSpans()).toHaveLength(1);
    });
  });

  describe('setAttributes', () => {
    it('should set attributes on active span', () => {
      const tracerInstance = provider.getTracer('test');
      const activeSpan = tracerInstance.startSpan('tool my_tool');
      const store = new Map<string | symbol, unknown>();
      store.set(ACTIVE_SPAN_KEY, activeSpan);

      const ctx = {
        ...makeCtx(),
        get: <T>(key: string | symbol): T | undefined => store.get(key) as T | undefined,
      };

      const accessor = new TelemetryAccessor(ctx);
      accessor.setAttributes({ 'user.tier': 'premium', 'request.size': 1024 });

      activeSpan.end();

      const spans = exporter.getFinishedSpans();
      const toolSpan = spans.find((s) => s.name === 'tool my_tool');
      expect(toolSpan!.attributes['user.tier']).toBe('premium');
      expect(toolSpan!.attributes['request.size']).toBe(1024);
    });

    it('should be a no-op when no active span', () => {
      const accessor = new TelemetryAccessor(makeCtx());
      // Should not throw
      accessor.setAttributes({ key: 'value' });
      expect(exporter.getFinishedSpans()).toHaveLength(0);
    });
  });

  describe('startSpan with active context', () => {
    it('should create child under active execution span', () => {
      const tracerInstance = provider.getTracer('test');
      const activeSpan = tracerInstance.startSpan('tool my_tool');
      const activeCtx = trace.setSpan(otelContext.active(), activeSpan);
      const store = new Map<string | symbol, unknown>();
      store.set(ACTIVE_SPAN_KEY, activeSpan);
      store.set(ACTIVE_OTEL_CTX_KEY, activeCtx);

      const ctx = {
        ...makeCtx(),
        get: <T>(key: string | symbol): T | undefined => store.get(key) as T | undefined,
      };

      const accessor = new TelemetryAccessor(ctx);
      const child = accessor.startSpan('sub-operation');
      child.end();
      activeSpan.end();

      const spans = exporter.getFinishedSpans();
      const childSpan = spans.find((s) => s.name === 'sub-operation');
      const parentSpan = spans.find((s) => s.name === 'tool my_tool');
      expect(childSpan).toBeTruthy();
      expect(parentSpan).toBeTruthy();
      // Child should reference parent's span ID
      expect(childSpan!.parentSpanId).toBe(parentSpan!.spanContext().spanId);
    });
  });

  describe('traceId', () => {
    it('should return the current trace ID', () => {
      const accessor = new TelemetryAccessor(makeCtx());
      expect(accessor.traceId).toBe('a'.repeat(32));
    });
  });

  describe('sessionId', () => {
    it('should return the hashed session ID', () => {
      const accessor = new TelemetryAccessor(makeCtx());
      expect(accessor.sessionId).toMatch(/^[a-f0-9]{16}$/);
    });
  });
});

describe('TelemetrySpan', () => {
  beforeEach(() => exporter.reset());

  it('should support chaining setAttribute', () => {
    const accessor = new TelemetryAccessor(makeCtx());
    const span = accessor.startSpan('chain-test');
    const result = span.setAttribute('a', 1).setAttribute('b', 'two');
    expect(result).toBe(span); // chaining returns this
    span.end();
  });

  it('should support setAttributes', () => {
    const accessor = new TelemetryAccessor(makeCtx());
    const span = accessor.startSpan('multi');
    span.setAttributes({ x: 1, y: 'z' });
    span.end();

    const exported = exporter.getFinishedSpans()[0];
    expect(exported.attributes['x']).toBe(1);
    expect(exported.attributes['y']).toBe('z');
  });

  it('should support addEvent chaining', () => {
    const accessor = new TelemetryAccessor(makeCtx());
    const span = accessor.startSpan('events');
    const result = span.addEvent('e1').addEvent('e2', { key: 'val' });
    expect(result).toBe(span);
    span.end();

    expect(exporter.getFinishedSpans()[0].events).toHaveLength(2);
  });

  it('should support recordError', () => {
    const accessor = new TelemetryAccessor(makeCtx());
    const span = accessor.startSpan('error-test');
    span.recordError(new Error('test error'));
    span.end();

    const exported = exporter.getFinishedSpans()[0];
    expect(exported.status.code).toBe(SpanStatusCode.ERROR);
    expect(exported.events.length).toBeGreaterThanOrEqual(1);
  });

  it('should support endWithError with string', () => {
    const accessor = new TelemetryAccessor(makeCtx());
    const span = accessor.startSpan('err');
    span.endWithError('string error');

    expect(exporter.getFinishedSpans()[0].status.code).toBe(SpanStatusCode.ERROR);
  });

  it('should expose raw OTel span', () => {
    const accessor = new TelemetryAccessor(makeCtx());
    const span = accessor.startSpan('raw');
    expect(span.raw).toBeTruthy();
    expect(typeof span.raw.end).toBe('function');
    span.end();
  });
});
