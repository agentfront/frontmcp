import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import type { ExportResult } from '@opentelemetry/core';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';

import { PrettySpanExporter } from '../otel/spans/pretty-span-exporter';

function makeSpan(overrides: Partial<ReadableSpan> = {}): ReadableSpan {
  return {
    name: 'tools/call',
    kind: SpanKind.SERVER,
    spanContext: () => ({
      traceId: '36008509abcdef0123456789abcdef01',
      spanId: 'aaaaaaaaaaaaaaaa',
      traceFlags: 1,
    }),
    parentSpanId: undefined,
    parentSpanContext: undefined,
    startTime: [0, 0],
    endTime: [0, 8_000_000],
    duration: [0, 8_000_000],
    status: { code: SpanStatusCode.OK },
    attributes: {
      'rpc.system': 'mcp',
      'mcp.session.id': '5bfdd288',
      'frontmcp.tool.name': 'echo',
      'irrelevant.attribute': 'should not appear',
    },
    links: [],
    events: [],
    instrumentationLibrary: { name: 'test', version: '0.0.0' },
    instrumentationScope: { name: 'test', version: '0.0.0' },
    resource: { attributes: {}, asyncAttributesPending: false } as ReadableSpan['resource'],
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    ended: true,
    ...overrides,
  } as ReadableSpan;
}

describe('PrettySpanExporter', () => {
  let logs: string[];
  let originalLog: typeof console.log;

  beforeEach(() => {
    logs = [];
    originalLog = console.log;
    console.log = (msg: string) => logs.push(String(msg));
  });

  afterEach(() => {
    console.log = originalLog;
  });

  it('writes one line per span and reports success via the result callback', () => {
    const exporter = new PrettySpanExporter();
    const result: ExportResult[] = [];
    exporter.export([makeSpan(), makeSpan({ name: 'tool echo' })], (r) => result.push(r));
    expect(logs).toHaveLength(2);
    expect(result).toEqual([{ code: 0 }]);
  });

  it('formats plain (non-ANSI) output with key attributes shortened', () => {
    const exporter = new PrettySpanExporter();
    // Force non-ANSI mode for deterministic output
    (exporter as unknown as { useAnsi: boolean }).useAnsi = false;
    exporter.export([makeSpan()], () => undefined);
    expect(logs[0]).toContain('SPAN tools/call');
    expect(logs[0]).toContain('[36008509]');
    expect(logs[0]).toContain('SERVER');
    expect(logs[0]).toContain('rpc.system=mcp');
    expect(logs[0]).toContain('session.id=5bfdd288');
    expect(logs[0]).toContain('tool.name=echo'); // `frontmcp.` prefix stripped
    expect(logs[0]).not.toContain('irrelevant.attribute');
  });

  it('emits ANSI escape codes when useAnsi=true and renders without errors', () => {
    const exporter = new PrettySpanExporter();
    (exporter as unknown as { useAnsi: boolean }).useAnsi = true;
    exporter.export([makeSpan()], () => undefined);
    expect(logs[0]).toContain('\x1b['); // contains an ANSI escape
    expect(logs[0]).toContain('SPAN');
  });

  it('renders RED status when span errored (ANSI mode)', () => {
    const exporter = new PrettySpanExporter();
    (exporter as unknown as { useAnsi: boolean }).useAnsi = true;
    exporter.export([makeSpan({ status: { code: SpanStatusCode.ERROR } })], () => undefined);
    expect(logs[0]).toContain('\x1b[31m'); // RED
  });

  it('uses CYAN for SERVER spans and DIM for other kinds (ANSI mode)', () => {
    const exporter = new PrettySpanExporter();
    (exporter as unknown as { useAnsi: boolean }).useAnsi = true;
    exporter.export([makeSpan({ kind: SpanKind.SERVER })], () => undefined);
    expect(logs[0]).toContain('\x1b[36m'); // CYAN
    logs.length = 0;
    exporter.export([makeSpan({ kind: SpanKind.INTERNAL })], () => undefined);
    expect(logs[0]).toContain('\x1b[2m'); // DIM
  });

  it('falls back to UNKNOWN for an unrecognized kind', () => {
    const exporter = new PrettySpanExporter();
    (exporter as unknown as { useAnsi: boolean }).useAnsi = false;
    exporter.export([makeSpan({ kind: 99 as unknown as SpanKind })], () => undefined);
    expect(logs[0]).toContain('UNKNOWN');
  });

  it('renders an event summary when the span has events', () => {
    const exporter = new PrettySpanExporter();
    (exporter as unknown as { useAnsi: boolean }).useAnsi = false;
    exporter.export(
      [
        makeSpan({
          events: [
            { name: 'a', time: [0, 0], attributes: {}, droppedAttributesCount: 0 },
            { name: 'b', time: [0, 0], attributes: {}, droppedAttributesCount: 0 },
          ],
        }),
      ],
      () => undefined,
    );
    expect(logs[0]).toContain('(2 events)');
  });

  it('renders an event summary in ANSI mode too', () => {
    const exporter = new PrettySpanExporter();
    (exporter as unknown as { useAnsi: boolean }).useAnsi = true;
    exporter.export(
      [
        makeSpan({
          events: [{ name: 'x', time: [0, 0], attributes: {}, droppedAttributesCount: 0 }],
        }),
      ],
      () => undefined,
    );
    expect(logs[0]).toContain('(1 events)');
  });

  it('omits the attrs segment when nothing matches the inline allowlist', () => {
    const exporter = new PrettySpanExporter();
    (exporter as unknown as { useAnsi: boolean }).useAnsi = false;
    exporter.export([makeSpan({ attributes: { 'unrecognized.attr': 'x' } })], () => undefined);
    expect(logs[0]).not.toContain('unrecognized.attr');
  });

  it('shutdown resolves', async () => {
    const exporter = new PrettySpanExporter();
    await expect(exporter.shutdown()).resolves.toBeUndefined();
  });

  it('useAnsi is initialized from process.stdout.isTTY at construction', () => {
    const realIsTTY = process.stdout.isTTY;
    try {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      const e1 = new PrettySpanExporter();
      expect((e1 as unknown as { useAnsi: boolean }).useAnsi).toBe(true);

      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      const e2 = new PrettySpanExporter();
      expect((e2 as unknown as { useAnsi: boolean }).useAnsi).toBe(false);
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { value: realIsTTY, configurable: true });
    }
  });
});
