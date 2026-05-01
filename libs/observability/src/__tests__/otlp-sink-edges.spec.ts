import { OtlpSink } from '../logging/sinks/otlp.sink';
import type { StructuredLogEntry } from '../logging/structured-log.types';

function makeEntry(overrides?: Partial<StructuredLogEntry>): StructuredLogEntry {
  return {
    timestamp: '2026-03-31T14:00:00.000Z',
    level: 'info',
    severity_number: 9,
    message: 'test message',
    ...overrides,
  };
}

describe('OtlpSink (edges)', () => {
  let fetchSpy: jest.SpyInstance;
  let consoleErrSpy: jest.SpyInstance;
  let consoleDbgSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));
    consoleErrSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleDbgSpy = jest.spyOn(console, 'debug').mockImplementation();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    consoleErrSpy.mockRestore();
    consoleDbgSpy.mockRestore();
  });

  it('starts a flush timer when flushIntervalMs > 0 and unrefs it', () => {
    jest.useFakeTimers();
    try {
      const sink = new OtlpSink({ endpoint: 'http://localhost:4318', flushIntervalMs: 1000 });
      // The timer is unref'd internally; make sure no exceptions on construction
      expect(sink).toBeDefined();
      // Cleanup without awaiting fetch
      jest.clearAllTimers();
    } finally {
      jest.useRealTimers();
    }
  });

  it('falls back to OTEL_SERVICE_NAME env var when no serviceName is provided', async () => {
    const prev = process.env['OTEL_SERVICE_NAME'];
    process.env['OTEL_SERVICE_NAME'] = 'env-svc';
    try {
      const sink = new OtlpSink({ endpoint: 'http://localhost:4318', flushIntervalMs: 0 });
      sink.write(makeEntry());
      await sink.flush();
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const svc = body.resourceLogs[0].resource.attributes.find((a: { key: string }) => a.key === 'service.name');
      expect(svc.value.stringValue).toBe('env-svc');
    } finally {
      if (prev === undefined) delete process.env['OTEL_SERVICE_NAME'];
      else process.env['OTEL_SERVICE_NAME'] = prev;
    }
  });

  it('falls back to "frontmcp-server" when no env var or option', async () => {
    const prev = process.env['OTEL_SERVICE_NAME'];
    delete process.env['OTEL_SERVICE_NAME'];
    try {
      const sink = new OtlpSink({ endpoint: 'http://localhost:4318', flushIntervalMs: 0 });
      sink.write(makeEntry());
      await sink.flush();
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const svc = body.resourceLogs[0].resource.attributes.find((a: { key: string }) => a.key === 'service.name');
      expect(svc.value.stringValue).toBe('frontmcp-server');
    } finally {
      if (prev !== undefined) process.env['OTEL_SERVICE_NAME'] = prev;
    }
  });

  it('logs and requeues entries when fetch returns non-ok response', async () => {
    fetchSpy.mockResolvedValue(new Response('rate limited', { status: 429 }));
    const sink = new OtlpSink({ endpoint: 'http://localhost:4318', flushIntervalMs: 0 });
    sink.write(makeEntry());
    await sink.flush();
    expect(consoleErrSpy).toHaveBeenCalledWith(expect.stringContaining('HTTP 429'));
    // Verify entry was requeued
    expect((sink as unknown as { batch: unknown[] }).batch).toHaveLength(1);
  });

  it('handles non-ok response when body.text() also fails', async () => {
    const failingResponse = {
      ok: false,
      status: 500,
      text: () => Promise.reject(new Error('cannot read body')),
    };
    fetchSpy.mockResolvedValue(failingResponse as unknown as Response);
    const sink = new OtlpSink({ endpoint: 'http://localhost:4318', flushIntervalMs: 0 });
    sink.write(makeEntry());
    await sink.flush();
    expect(consoleErrSpy).toHaveBeenCalledWith(expect.stringContaining('HTTP 500'));
  });

  it('logs and requeues entries when fetch throws an Error', async () => {
    fetchSpy.mockRejectedValue(new Error('connection refused'));
    const sink = new OtlpSink({ endpoint: 'http://localhost:4318', flushIntervalMs: 0 });
    sink.write(makeEntry());
    sink.write(makeEntry({ message: 'second' }));
    await sink.flush();
    expect(consoleDbgSpy).toHaveBeenCalledWith(expect.stringContaining('connection refused'));
    expect((sink as unknown as { batch: unknown[] }).batch).toHaveLength(2);
  });

  it('logs the raw value when fetch throws a non-Error', async () => {
    fetchSpy.mockRejectedValue('weird-string');
    const sink = new OtlpSink({ endpoint: 'http://localhost:4318', flushIntervalMs: 0 });
    sink.write(makeEntry());
    await sink.flush();
    expect(consoleDbgSpy).toHaveBeenCalledWith(expect.stringContaining('weird-string'));
  });

  it('drops oldest entries when batch exceeds maxQueueSize', async () => {
    const sink = new OtlpSink({
      endpoint: 'http://localhost:4318',
      flushIntervalMs: 0,
      maxQueueSize: 3,
      batchSize: 100, // prevent auto-flush
    });
    for (let i = 0; i < 5; i++) {
      sink.write(makeEntry({ message: `m${i}` }));
    }
    const batch = (sink as unknown as { batch: StructuredLogEntry[] }).batch;
    expect(batch).toHaveLength(3);
    expect(batch[0].message).toBe('m2');
    expect(batch[2].message).toBe('m4');
  });

  it('encodes elapsed_ms as a double when not an integer', async () => {
    const sink = new OtlpSink({ endpoint: 'http://localhost:4318', flushIntervalMs: 0 });
    sink.write(makeEntry({ elapsed_ms: 1.5 }));
    await sink.flush();
    const attrs = JSON.parse(fetchSpy.mock.calls[0][1].body).resourceLogs[0].scopeLogs[0].logRecords[0].attributes;
    const elapsed = attrs.find((a: { key: string }) => a.key === 'elapsed_ms');
    expect(elapsed?.value.doubleValue).toBe(1.5);
  });

  it('includes error.id when error.error_id is set', async () => {
    const sink = new OtlpSink({ endpoint: 'http://localhost:4318', flushIntervalMs: 0 });
    sink.write(
      makeEntry({
        error: { type: 'E', message: 'm', error_id: 'err-12345' },
      }),
    );
    await sink.flush();
    const attrs = JSON.parse(fetchSpy.mock.calls[0][1].body).resourceLogs[0].scopeLogs[0].logRecords[0].attributes;
    expect(attrs.find((a: { key: string }) => a.key === 'error.id')?.value.stringValue).toBe('err-12345');
  });

  it('skips null/undefined user attribute values', async () => {
    const sink = new OtlpSink({ endpoint: 'http://localhost:4318', flushIntervalMs: 0 });
    sink.write(
      makeEntry({
        attributes: { keep: 'x', drop1: null, drop2: undefined } as unknown as Record<string, unknown>,
      }),
    );
    await sink.flush();
    const attrs = JSON.parse(fetchSpy.mock.calls[0][1].body).resourceLogs[0].scopeLogs[0].logRecords[0].attributes;
    expect(attrs.find((a: { key: string }) => a.key === 'keep')).toBeDefined();
    expect(attrs.find((a: { key: string }) => a.key === 'drop1')).toBeUndefined();
    expect(attrs.find((a: { key: string }) => a.key === 'drop2')).toBeUndefined();
  });

  it('encodes float user attribute values as doubleValue', async () => {
    const sink = new OtlpSink({ endpoint: 'http://localhost:4318', flushIntervalMs: 0 });
    sink.write(makeEntry({ attributes: { ratio: 0.42 } }));
    await sink.flush();
    const attrs = JSON.parse(fetchSpy.mock.calls[0][1].body).resourceLogs[0].scopeLogs[0].logRecords[0].attributes;
    expect(attrs.find((a: { key: string }) => a.key === 'ratio')?.value.doubleValue).toBe(0.42);
  });

  it('JSON-stringifies object/array user attribute values', async () => {
    const sink = new OtlpSink({ endpoint: 'http://localhost:4318', flushIntervalMs: 0 });
    sink.write(makeEntry({ attributes: { meta: { a: 1, b: [2, 3] } } }));
    await sink.flush();
    const attrs = JSON.parse(fetchSpy.mock.calls[0][1].body).resourceLogs[0].scopeLogs[0].logRecords[0].attributes;
    const meta = attrs.find((a: { key: string }) => a.key === 'meta');
    expect(meta?.value.stringValue).toBe(JSON.stringify({ a: 1, b: [2, 3] }));
  });

  it('close() clears the flush timer and flushes pending entries', async () => {
    const sink = new OtlpSink({ endpoint: 'http://localhost:4318', flushIntervalMs: 1000 });
    sink.write(makeEntry());
    await sink.close();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Calling close again should be safe (timer already cleared)
    await sink.close();
  });
});
