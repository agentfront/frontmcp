/**
 * OTel Context Propagator — integrates FrontMCP's W3C trace context
 * parsing with OpenTelemetry's context propagation.
 *
 * This propagator uses the existing FrontMCP trace context parser
 * to extract and inject W3C traceparent headers.
 */

import {
  type Context,
  type TextMapGetter,
  type TextMapSetter,
  type TextMapPropagator,
  trace,
} from '@opentelemetry/api';

const TRACEPARENT_HEADER = 'traceparent';

/**
 * FrontMcpPropagator — OTel TextMapPropagator that reads/writes
 * the W3C traceparent header using the same format as the SDK.
 */
export class FrontMcpPropagator implements TextMapPropagator {
  inject(context: Context, carrier: unknown, setter: TextMapSetter): void {
    const span = trace.getSpan(context);
    if (!span) return;

    const sc = span.spanContext();
    if (!sc || !isValidSpanContext(sc)) return;

    const flags = sc.traceFlags.toString(16).padStart(2, '0');
    const traceparent = `00-${sc.traceId}-${sc.spanId}-${flags}`;
    setter.set(carrier, TRACEPARENT_HEADER, traceparent);
  }

  extract(context: Context, carrier: unknown, getter: TextMapGetter): Context {
    const traceparent = getter.get(carrier, TRACEPARENT_HEADER);
    const value = Array.isArray(traceparent) ? traceparent[0] : traceparent;
    if (!value) return context;

    const parsed = parseTraceparent(value);
    if (!parsed) return context;

    const spanContext = {
      traceId: parsed.traceId,
      spanId: parsed.parentId,
      traceFlags: parsed.traceFlags,
      isRemote: true as const,
    };

    const span = trace.wrapSpanContext(spanContext);
    return trace.setSpan(context, span);
  }

  fields(): string[] {
    return [TRACEPARENT_HEADER];
  }
}

/**
 * Parse a W3C traceparent header.
 * Replicates the SDK's parsing logic to avoid the circular dependency.
 */
function parseTraceparent(value: string): { traceId: string; parentId: string; traceFlags: number } | null {
  const parts = value.split('-');
  if (parts.length !== 4) return null;

  const [version, traceId, parentId, flags] = parts;
  if (version !== '00') return null;
  if (!/^[a-f0-9]{32}$/i.test(traceId) || traceId === '00000000000000000000000000000000') return null;
  if (!/^[a-f0-9]{16}$/i.test(parentId) || parentId === '0000000000000000') return null;

  if (!/^[0-9a-fA-F]{2}$/.test(flags)) return null;
  const traceFlags = parseInt(flags, 16);

  return {
    traceId: traceId.toLowerCase(),
    parentId: parentId.toLowerCase(),
    traceFlags,
  };
}

function isValidSpanContext(sc: { traceId: string; spanId: string }): boolean {
  return (
    sc.traceId !== '00000000000000000000000000000000' &&
    sc.spanId !== '0000000000000000' &&
    sc.traceId.length === 32 &&
    sc.spanId.length === 16
  );
}
