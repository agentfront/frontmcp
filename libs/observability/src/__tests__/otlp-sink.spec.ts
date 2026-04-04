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

describe('OtlpSink', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('should batch entries and flush', async () => {
    const sink = new OtlpSink({
      endpoint: 'http://localhost:4318',
      flushIntervalMs: 0, // disable timer
    });

    sink.write(makeEntry({ message: 'first' }));
    sink.write(makeEntry({ message: 'second' }));

    await sink.flush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://localhost:4318/v1/logs');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(opts.body);
    const logRecords = body.resourceLogs[0].scopeLogs[0].logRecords;
    expect(logRecords).toHaveLength(2);
    expect(logRecords[0].body.stringValue).toBe('first');
    expect(logRecords[1].body.stringValue).toBe('second');
  });

  it('should include trace correlation', async () => {
    const sink = new OtlpSink({ endpoint: 'http://localhost:4318', flushIntervalMs: 0 });

    sink.write(
      makeEntry({
        trace_id: 'abc123',
        span_id: 'def456',
        trace_flags: 1,
      }),
    );

    await sink.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const record = body.resourceLogs[0].scopeLogs[0].logRecords[0];
    expect(record.traceId).toBe('abc123');
    expect(record.spanId).toBe('def456');
    expect(record.flags).toBe(1);
  });

  it('should include severity info', async () => {
    const sink = new OtlpSink({ endpoint: 'http://localhost:4318', flushIntervalMs: 0 });

    sink.write(makeEntry({ level: 'error', severity_number: 17 }));
    await sink.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const record = body.resourceLogs[0].scopeLogs[0].logRecords[0];
    expect(record.severityNumber).toBe(17);
    expect(record.severityText).toBe('ERROR');
  });

  it('should include request/session/scope attributes', async () => {
    const sink = new OtlpSink({ endpoint: 'http://localhost:4318', flushIntervalMs: 0 });

    sink.write(
      makeEntry({
        request_id: 'req-001',
        session_id_hash: 'sess123',
        scope_id: 'my-scope',
        flow_name: 'tools:call-tool',
        prefix: 'MyModule',
        elapsed_ms: 42,
      }),
    );

    await sink.flush();

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const attrs = body.resourceLogs[0].scopeLogs[0].logRecords[0].attributes;
    const getAttr = (key: string) => attrs.find((a: any) => a.key === key);

    expect(getAttr('frontmcp.request.id')?.value.stringValue).toBe('req-001');
    expect(getAttr('mcp.session.id')?.value.stringValue).toBe('sess123');
    expect(getAttr('frontmcp.scope.id')?.value.stringValue).toBe('my-scope');
    expect(getAttr('frontmcp.flow.name')?.value.stringValue).toBe('tools:call-tool');
    expect(getAttr('log.prefix')?.value.stringValue).toBe('MyModule');
    expect(getAttr('elapsed_ms')?.value.intValue).toBe('42');
  });

  it('should include error attributes', async () => {
    const sink = new OtlpSink({ endpoint: 'http://localhost:4318', flushIntervalMs: 0 });

    sink.write(
      makeEntry({
        error: { type: 'ValidationError', message: 'bad input', code: '-32602', stack: 'at line 1' },
      }),
    );

    await sink.flush();

    const attrs = JSON.parse(fetchSpy.mock.calls[0][1].body).resourceLogs[0].scopeLogs[0].logRecords[0].attributes;
    const getAttr = (key: string) => attrs.find((a: any) => a.key === key);

    expect(getAttr('error.type')?.value.stringValue).toBe('ValidationError');
    expect(getAttr('error.message')?.value.stringValue).toBe('bad input');
    expect(getAttr('error.code')?.value.stringValue).toBe('-32602');
    expect(getAttr('error.stack')?.value.stringValue).toBe('at line 1');
  });

  it('should include user attributes with correct types', async () => {
    const sink = new OtlpSink({ endpoint: 'http://localhost:4318', flushIntervalMs: 0 });

    sink.write(
      makeEntry({
        attributes: { name: 'alice', count: 42, active: true },
      }),
    );

    await sink.flush();

    const attrs = JSON.parse(fetchSpy.mock.calls[0][1].body).resourceLogs[0].scopeLogs[0].logRecords[0].attributes;
    const getAttr = (key: string) => attrs.find((a: any) => a.key === key);

    expect(getAttr('name')?.value.stringValue).toBe('alice');
    expect(getAttr('count')?.value.intValue).toBe('42');
    expect(getAttr('active')?.value.boolValue).toBe(true);
  });

  it('should set service name from option', async () => {
    const sink = new OtlpSink({ endpoint: 'http://localhost:4318', flushIntervalMs: 0, serviceName: 'my-api' });

    sink.write(makeEntry());
    await sink.flush();

    const resource = JSON.parse(fetchSpy.mock.calls[0][1].body).resourceLogs[0].resource;
    const svcAttr = resource.attributes.find((a: any) => a.key === 'service.name');
    expect(svcAttr?.value.stringValue).toBe('my-api');
  });

  it('should auto-flush at batch size', async () => {
    const sink = new OtlpSink({ endpoint: 'http://localhost:4318', batchSize: 2, flushIntervalMs: 0 });

    sink.write(makeEntry({ message: 'a' }));
    // No flush yet
    expect(fetchSpy).not.toHaveBeenCalled();

    sink.write(makeEntry({ message: 'b' }));
    // Should trigger flush at batchSize=2
    // Give the async flush a tick
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('should not flush when batch is empty', async () => {
    const sink = new OtlpSink({ endpoint: 'http://localhost:4318', flushIntervalMs: 0 });
    await sink.flush();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should handle fetch errors gracefully', async () => {
    fetchSpy.mockRejectedValue(new Error('network error'));
    const sink = new OtlpSink({ endpoint: 'http://bad-host:4318', flushIntervalMs: 0 });
    sink.write(makeEntry());
    await sink.flush(); // Should not throw
  });

  it('should include custom headers', async () => {
    const sink = new OtlpSink({
      endpoint: 'http://localhost:4318',
      headers: { Authorization: 'Bearer MY_TOKEN' },
      flushIntervalMs: 0,
    });

    sink.write(makeEntry());
    await sink.flush();

    expect(fetchSpy.mock.calls[0][1].headers['Authorization']).toBe('Bearer MY_TOKEN');
  });

  it('should strip trailing slash from endpoint', async () => {
    const sink = new OtlpSink({ endpoint: 'http://localhost:4318/', flushIntervalMs: 0 });
    sink.write(makeEntry());
    await sink.flush();

    expect(fetchSpy.mock.calls[0][0]).toBe('http://localhost:4318/v1/logs');
  });

  it('should strip multiple trailing slashes from endpoint', async () => {
    const sink = new OtlpSink({ endpoint: 'http://localhost:4318///', flushIntervalMs: 0 });
    sink.write(makeEntry());
    await sink.flush();

    expect(fetchSpy.mock.calls[0][0]).toBe('http://localhost:4318/v1/logs');
  });

  it('should flush on close', async () => {
    const sink = new OtlpSink({ endpoint: 'http://localhost:4318', flushIntervalMs: 0 });
    sink.write(makeEntry());
    await sink.close();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('should set scope name', async () => {
    const sink = new OtlpSink({ endpoint: 'http://localhost:4318', flushIntervalMs: 0 });
    sink.write(makeEntry());
    await sink.flush();

    const scope = JSON.parse(fetchSpy.mock.calls[0][1].body).resourceLogs[0].scopeLogs[0].scope;
    expect(scope.name).toBe('@frontmcp/observability');
  });
});
