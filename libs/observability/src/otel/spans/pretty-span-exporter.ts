/**
 * PrettySpanExporter — human-readable span output for development.
 *
 * Instead of dumping raw JSON (like ConsoleSpanExporter), formats spans
 * as compact, colored one-liners with key attributes and timing.
 *
 * Example output:
 *   ↳ SPAN tools/call [36008509] 8ms rpc.system=mcp mcp.session.id=5bfdd288
 *   ↳ SPAN tool get_weather [36008509] 5ms mcp.component.type=tool enduser.id=client-42
 */

import type { SpanExporter, ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import type { ExportResult } from '@opentelemetry/core';

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';

const KIND_LABELS: Record<number, string> = {
  [SpanKind.INTERNAL]: 'INTERNAL',
  [SpanKind.SERVER]: 'SERVER',
  [SpanKind.CLIENT]: 'CLIENT',
  [SpanKind.PRODUCER]: 'PRODUCER',
  [SpanKind.CONSUMER]: 'CONSUMER',
};

/** Key attributes to show inline (skip internal/verbose ones) */
const SHOW_ATTRS = new Set([
  'rpc.system',
  'rpc.method',
  'rpc.service',
  'mcp.method.name',
  'mcp.session.id',
  'mcp.component.type',
  'mcp.component.key',
  'http.request.method',
  'http.response.status_code',
  'url.path',
  'frontmcp.tool.name',
  'frontmcp.tool.owner',
  'frontmcp.transport.type',
  'frontmcp.transport.request_type',
  'frontmcp.auth.mode',
  'frontmcp.auth.result',
  'frontmcp.flow.name',
  'enduser.id',
]);

export class PrettySpanExporter implements SpanExporter {
  private useAnsi: boolean;

  constructor() {
    this.useAnsi = typeof process !== 'undefined' && !!process.stdout?.isTTY;
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    for (const span of spans) {
      console.log(this.format(span));
    }
    resultCallback({ code: 0 });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  private format(span: ReadableSpan): string {
    const traceShort = span.spanContext().traceId.slice(0, 8);
    const durationMs = (span.duration[0] * 1000 + span.duration[1] / 1_000_000).toFixed(1);
    const kind = KIND_LABELS[span.kind] ?? 'UNKNOWN';
    const statusOk = span.status.code !== SpanStatusCode.ERROR;

    // Key attributes (compact, inline)
    const attrs = Object.entries(span.attributes)
      .filter(([k]) => SHOW_ATTRS.has(k))
      .map(([k, v]) => {
        const short = k.replace('frontmcp.', '').replace('mcp.', '');
        return `${short}=${v}`;
      })
      .join(' ');

    // Events summary
    const eventCount = span.events.length;
    const eventSummary = eventCount > 0 ? ` (${eventCount} events)` : '';

    if (this.useAnsi) {
      const statusColor = statusOk ? GREEN : RED;
      const kindColor = span.kind === SpanKind.SERVER ? CYAN : DIM;
      return [
        `${DIM}↳${RESET}`,
        `${BOLD}${statusColor}SPAN${RESET}`,
        `${BOLD}${span.name}${RESET}`,
        `${DIM}[${traceShort}]${RESET}`,
        `${YELLOW}${durationMs}ms${RESET}`,
        `${kindColor}${kind}${RESET}`,
        attrs ? `${DIM}${attrs}${RESET}` : '',
        eventSummary ? `${DIM}${eventSummary}${RESET}` : '',
      ]
        .filter(Boolean)
        .join(' ');
    }

    return ['↳ SPAN', span.name, `[${traceShort}]`, `${durationMs}ms`, kind, attrs, eventSummary]
      .filter(Boolean)
      .join(' ');
  }
}
