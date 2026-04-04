import { trace, ROOT_CONTEXT, TraceFlags, defaultTextMapGetter, defaultTextMapSetter } from '@opentelemetry/api';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { FrontMcpPropagator } from '../otel/context-propagator';

describe('FrontMcpPropagator', () => {
  const propagator = new FrontMcpPropagator();

  describe('fields', () => {
    it('should return traceparent', () => {
      expect(propagator.fields()).toEqual(['traceparent']);
    });
  });

  describe('extract', () => {
    it('should extract valid traceparent header', () => {
      const carrier: Record<string, string> = {
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      };

      const context = propagator.extract(ROOT_CONTEXT, carrier, defaultTextMapGetter);
      const span = trace.getSpan(context);

      expect(span).toBeTruthy();
      const sc = span!.spanContext();
      expect(sc.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
      expect(sc.spanId).toBe('b7ad6b7169203331');
      expect(sc.traceFlags).toBe(TraceFlags.SAMPLED);
      expect(sc.isRemote).toBe(true);
    });

    it('should return original context for invalid traceparent', () => {
      const carrier: Record<string, string> = {
        traceparent: 'invalid',
      };

      const context = propagator.extract(ROOT_CONTEXT, carrier, defaultTextMapGetter);
      expect(trace.getSpan(context)).toBeUndefined();
    });

    it('should return original context when no traceparent', () => {
      const carrier: Record<string, string> = {};
      const context = propagator.extract(ROOT_CONTEXT, carrier, defaultTextMapGetter);
      expect(trace.getSpan(context)).toBeUndefined();
    });

    it('should reject invalid version', () => {
      const carrier = { traceparent: '01-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01' };
      const context = propagator.extract(ROOT_CONTEXT, carrier, defaultTextMapGetter);
      expect(trace.getSpan(context)).toBeUndefined();
    });

    it('should reject all-zero traceId', () => {
      const carrier = { traceparent: '00-' + '0'.repeat(32) + '-' + 'b'.repeat(16) + '-01' };
      const context = propagator.extract(ROOT_CONTEXT, carrier, defaultTextMapGetter);
      expect(trace.getSpan(context)).toBeUndefined();
    });

    it('should reject all-zero parentId', () => {
      const carrier = { traceparent: '00-' + 'a'.repeat(32) + '-' + '0'.repeat(16) + '-01' };
      const context = propagator.extract(ROOT_CONTEXT, carrier, defaultTextMapGetter);
      expect(trace.getSpan(context)).toBeUndefined();
    });

    it('should reject invalid traceFlags', () => {
      const carrier = { traceparent: '00-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-zz' };
      const context = propagator.extract(ROOT_CONTEXT, carrier, defaultTextMapGetter);
      expect(trace.getSpan(context)).toBeUndefined();
    });

    it('should handle traceparent as array', () => {
      const getter = {
        get: (_carrier: unknown, key: string) => {
          if (key === 'traceparent') {
            return ['00-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01'];
          }
          return undefined;
        },
        keys: () => ['traceparent'],
      };
      const context = propagator.extract(ROOT_CONTEXT, {}, getter);
      const span = trace.getSpan(context);
      expect(span).toBeTruthy();
    });
  });

  describe('inject', () => {
    it('should inject traceparent header from active span', () => {
      const carrier: Record<string, string> = {};

      const provider = new BasicTracerProvider();
      provider.addSpanProcessor(new SimpleSpanProcessor(new InMemorySpanExporter()));
      // Get tracer directly from provider, do NOT register globally
      const tracer = provider.getTracer('test');

      const span = tracer.startSpan('test-span');
      const ctx = trace.setSpan(ROOT_CONTEXT, span);

      propagator.inject(ctx, carrier, defaultTextMapSetter);

      expect(carrier['traceparent']).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-[a-f0-9]{2}$/);

      span.end();
      provider.shutdown();
    });

    it('should not inject when no span in context', () => {
      const carrier: Record<string, string> = {};
      propagator.inject(ROOT_CONTEXT, carrier, defaultTextMapSetter);
      expect(carrier['traceparent']).toBeUndefined();
    });
  });
});
