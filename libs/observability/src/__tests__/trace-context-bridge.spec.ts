import { TraceFlags } from '@opentelemetry/api';
import {
  frontmcpToOTelSpanContext,
  otelToFrontmcpContext,
  createOTelContextFromTrace,
} from '../otel/trace-context-bridge';
import type { TraceContextLike } from '../otel/trace-context-bridge';
import { trace } from '@opentelemetry/api';

describe('TraceContext Bridge', () => {
  const sampleContext: TraceContextLike = {
    traceId: '0af7651916cd43dd8448eb211c80319c',
    parentId: 'b7ad6b7169203331',
    traceFlags: 0x01,
    raw: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
  };

  describe('frontmcpToOTelSpanContext', () => {
    it('should map traceId correctly', () => {
      const sc = frontmcpToOTelSpanContext(sampleContext);
      expect(sc.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
    });

    it('should map parentId to spanId', () => {
      const sc = frontmcpToOTelSpanContext(sampleContext);
      expect(sc.spanId).toBe('b7ad6b7169203331');
    });

    it('should set SAMPLED flag when traceFlags has bit 0', () => {
      const sc = frontmcpToOTelSpanContext(sampleContext);
      expect(sc.traceFlags).toBe(TraceFlags.SAMPLED);
    });

    it('should set NONE when traceFlags is 0', () => {
      const sc = frontmcpToOTelSpanContext({ ...sampleContext, traceFlags: 0 });
      expect(sc.traceFlags).toBe(TraceFlags.NONE);
    });

    it('should mark as remote', () => {
      const sc = frontmcpToOTelSpanContext(sampleContext);
      expect(sc.isRemote).toBe(true);
    });
  });

  describe('otelToFrontmcpContext', () => {
    it('should map back to FrontMCP TraceContext', () => {
      const otelSc = {
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        traceFlags: TraceFlags.SAMPLED,
      };
      const tc = otelToFrontmcpContext(otelSc);
      expect(tc.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
      expect(tc.parentId).toBe('b7ad6b7169203331');
      expect(tc.traceFlags).toBe(1);
      expect(tc.raw).toBe('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01');
    });

    it('should handle NONE flags', () => {
      const tc = otelToFrontmcpContext({
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        traceFlags: TraceFlags.NONE,
      });
      expect(tc.raw).toMatch(/-00$/);
    });
  });

  describe('round-trip conversion', () => {
    it('should preserve data through frontmcp → otel → frontmcp', () => {
      const otel = frontmcpToOTelSpanContext(sampleContext);
      const roundTrip = otelToFrontmcpContext(otel);
      expect(roundTrip.traceId).toBe(sampleContext.traceId);
      expect(roundTrip.parentId).toBe(sampleContext.parentId);
      expect(roundTrip.traceFlags).toBe(sampleContext.traceFlags);
    });
  });

  describe('createOTelContextFromTrace', () => {
    it('should create an OTel context with the trace as parent', () => {
      const otelCtx = createOTelContextFromTrace(sampleContext);
      const span = trace.getSpan(otelCtx);
      expect(span).toBeTruthy();
      expect(span?.spanContext().traceId).toBe(sampleContext.traceId);
      expect(span?.spanContext().spanId).toBe(sampleContext.parentId);
    });
  });
});
