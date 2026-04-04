import { StructuredLogTransport } from '../logging/structured-log-transport';
import type { ContextSnapshot } from '../logging/structured-log-transport';
import type { LogSink } from '../logging/log-sink.interface';
import type { StructuredLogEntry } from '../logging/structured-log.types';

// Use numeric values matching SDK's LogLevel enum
const LogLevel = { Debug: 0, Verbose: 1, Info: 2, Warn: 3, Error: 4 } as const;

function makeLogRecord(overrides?: Record<string, unknown>) {
  return {
    level: LogLevel.Info,
    levelName: 'info',
    message: 'test message',
    args: [] as unknown[],
    timestamp: new Date('2026-03-31T14:00:00.000Z'),
    prefix: '',
    ...overrides,
  };
}

function createMockSink(): LogSink & { entries: StructuredLogEntry[] } {
  const entries: StructuredLogEntry[] = [];
  return {
    entries,
    write: (entry: StructuredLogEntry) => entries.push(entry),
  };
}

describe('StructuredLogTransport', () => {
  it('should produce a StructuredLogEntry from a LogRecord', () => {
    const sink = createMockSink();
    const transport = new StructuredLogTransport([sink]);

    transport.log(makeLogRecord());

    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0]).toEqual(
      expect.objectContaining({
        timestamp: '2026-03-31T14:00:00.000Z',
        level: 'info',
        severity_number: expect.any(Number),
        message: 'test message',
      }),
    );
  });

  it('should include prefix when present', () => {
    const sink = createMockSink();
    const transport = new StructuredLogTransport([sink]);

    transport.log(makeLogRecord({ prefix: 'MyModule' }));

    expect(sink.entries[0].prefix).toBe('MyModule');
  });

  it('should not include prefix when empty', () => {
    const sink = createMockSink();
    const transport = new StructuredLogTransport([sink]);

    transport.log(makeLogRecord({ prefix: '' }));

    expect(sink.entries[0].prefix).toBeUndefined();
  });

  it('should enrich entries with context when available', () => {
    const sink = createMockSink();
    const ctx: ContextSnapshot = {
      requestId: 'req-123',
      traceContext: { traceId: 'abc123def456789012345678901234', parentId: 'span1234567890ab', traceFlags: 1 },
      sessionIdHash: 'hash12345678',
      scopeId: 'my-scope',
      flowName: 'tools:call-tool',
      elapsed: 42,
    };

    const transport = new StructuredLogTransport([sink], undefined, () => ctx);
    transport.log(makeLogRecord());

    expect(sink.entries[0]).toEqual(
      expect.objectContaining({
        trace_id: 'abc123def456789012345678901234',
        span_id: 'span1234567890ab',
        trace_flags: 1,
        request_id: 'req-123',
        session_id_hash: 'hash12345678',
        scope_id: 'my-scope',
        flow_name: 'tools:call-tool',
        elapsed_ms: 42,
      }),
    );
  });

  it('should handle context without flow name', () => {
    const sink = createMockSink();
    const ctx: ContextSnapshot = {
      requestId: 'req-123',
      traceContext: { traceId: 'a'.repeat(32), parentId: 'b'.repeat(16), traceFlags: 0 },
      sessionIdHash: 'hash123',
      scopeId: 'scope',
      elapsed: 0,
    };

    const transport = new StructuredLogTransport([sink], undefined, () => ctx);
    transport.log(makeLogRecord());

    expect(sink.entries[0].flow_name).toBeUndefined();
  });

  it('should handle no context (outside request)', () => {
    const sink = createMockSink();
    const transport = new StructuredLogTransport([sink], undefined, () => undefined);
    transport.log(makeLogRecord());

    expect(sink.entries[0].trace_id).toBeUndefined();
    expect(sink.entries[0].request_id).toBeUndefined();
  });

  it('should extract Error objects from args', () => {
    const sink = createMockSink();
    const transport = new StructuredLogTransport([sink]);

    const error = new Error('something failed');
    error.name = 'ValidationError';
    transport.log(makeLogRecord({ level: LogLevel.Error, levelName: 'error', args: [error] }));

    expect(sink.entries[0].error).toEqual(
      expect.objectContaining({
        type: 'Error',
        message: 'something failed',
        stack: expect.stringContaining('something failed'),
      }),
    );
  });

  it('should extract MCP error fields', () => {
    const sink = createMockSink();
    const transport = new StructuredLogTransport([sink]);

    const error = new Error('not found') as Error & { code: number; errorId: string };
    error.code = -32002;
    error.errorId = 'err-uuid-123';
    transport.log(makeLogRecord({ args: [error] }));

    expect(sink.entries[0].error).toEqual(
      expect.objectContaining({
        code: '-32002',
        error_id: 'err-uuid-123',
      }),
    );
  });

  it('should omit stack traces when includeStacks is false', () => {
    const sink = createMockSink();
    const transport = new StructuredLogTransport([sink], { includeStacks: false });

    transport.log(makeLogRecord({ args: [new Error('fail')] }));

    expect(sink.entries[0].error?.stack).toBeUndefined();
  });

  it('should merge plain objects from args into attributes', () => {
    const sink = createMockSink();
    const transport = new StructuredLogTransport([sink]);

    transport.log(makeLogRecord({ args: [{ userId: 123, action: 'login' }] }));

    expect(sink.entries[0].attributes).toEqual({ userId: 123, action: 'login' });
  });

  it('should redact sensitive fields from attributes', () => {
    const sink = createMockSink();
    const transport = new StructuredLogTransport([sink], { redactFields: ['password', 'token'] });

    transport.log(makeLogRecord({ args: [{ user: 'alice', password: 'secret', token: 'abc' }] }));

    expect(sink.entries[0].attributes).toEqual({
      user: 'alice',
      password: '[REDACTED]',
      token: '[REDACTED]',
    });
  });

  it('should include static fields in every entry', () => {
    const sink = createMockSink();
    const transport = new StructuredLogTransport([sink], {
      staticFields: { service: 'my-app', env: 'production' },
    });

    transport.log(makeLogRecord());

    expect(sink.entries[0]).toEqual(
      expect.objectContaining({
        service: 'my-app',
        env: 'production',
      }),
    );
  });

  it('should forward to multiple sinks', () => {
    const sink1 = createMockSink();
    const sink2 = createMockSink();
    const transport = new StructuredLogTransport([sink1, sink2]);

    transport.log(makeLogRecord());

    expect(sink1.entries).toHaveLength(1);
    expect(sink2.entries).toHaveLength(1);
  });

  it('should not break if a sink throws', () => {
    const failingSink: LogSink = {
      write: () => {
        throw new Error('sink error');
      },
    };
    const goodSink = createMockSink();
    const transport = new StructuredLogTransport([failingSink, goodSink]);

    // Should not throw
    transport.log(makeLogRecord());

    // Good sink still received the entry
    expect(goodSink.entries).toHaveLength(1);
  });

  it('should notify onEntry listener', () => {
    const sink = createMockSink();
    const transport = new StructuredLogTransport([sink]);
    const entries: StructuredLogEntry[] = [];
    transport.onEntry = (entry) => entries.push(entry);

    transport.log(makeLogRecord());

    expect(entries).toHaveLength(1);
  });

  it('should handle error without code or errorId', () => {
    const sink = createMockSink();
    const transport = new StructuredLogTransport([sink]);

    const error = new Error('plain error');
    transport.log(makeLogRecord({ args: [error] }));

    expect(sink.entries[0].error?.code).toBeUndefined();
    expect(sink.entries[0].error?.error_id).toBeUndefined();
  });

  it('should handle error with non-number code', () => {
    const sink = createMockSink();
    const transport = new StructuredLogTransport([sink]);

    const error = new Error('fail') as Error & { code: string };
    error.code = 'ENOENT'; // string code, not number
    transport.log(makeLogRecord({ args: [error] }));

    // String code is not extracted (only number codes are MCP error codes)
    expect(sink.entries[0].error?.code).toBeUndefined();
  });

  it('should ignore non-object, non-error args', () => {
    const sink = createMockSink();
    const transport = new StructuredLogTransport([sink]);

    transport.log(makeLogRecord({ args: ['string arg', 42, true, null] }));

    expect(sink.entries[0].attributes).toBeUndefined();
    expect(sink.entries[0].error).toBeUndefined();
  });

  it('should handle error without stack', () => {
    const sink = createMockSink();
    const transport = new StructuredLogTransport([sink]);

    const error = new Error('no stack');
    error.stack = undefined;
    transport.log(makeLogRecord({ args: [error] }));

    expect(sink.entries[0].error?.stack).toBeUndefined();
  });

  it('should handle unknown log level', () => {
    const sink = createMockSink();
    const transport = new StructuredLogTransport([sink]);

    transport.log(makeLogRecord({ level: 100, levelName: 'off' }));

    // Falls back to 'off' as level name and default severity
    expect(sink.entries[0].level).toBe('off');
  });

  it('should map log levels correctly', () => {
    const sink = createMockSink();
    const transport = new StructuredLogTransport([sink]);

    const levels = [
      { level: LogLevel.Debug, expected: 'debug' },
      { level: LogLevel.Verbose, expected: 'verbose' },
      { level: LogLevel.Info, expected: 'info' },
      { level: LogLevel.Warn, expected: 'warn' },
      { level: LogLevel.Error, expected: 'error' },
    ];

    for (const { level, expected } of levels) {
      transport.log(makeLogRecord({ level, levelName: expected }));
    }

    expect(sink.entries.map((e) => e.level)).toEqual(['debug', 'verbose', 'info', 'warn', 'error']);
  });

  it('should map verbose severity to DEBUG2 (6), not INFO (9)', () => {
    const sink = createMockSink();
    const transport = new StructuredLogTransport([sink]);

    transport.log(makeLogRecord({ level: LogLevel.Verbose, levelName: 'verbose' }));
    transport.log(makeLogRecord({ level: LogLevel.Info, levelName: 'info' }));

    expect(sink.entries[0].severity_number).toBe(6);
    expect(sink.entries[1].severity_number).toBe(9);
  });

  it('should not let staticFields clobber canonical fields', () => {
    const sink = createMockSink();
    const transport = new StructuredLogTransport([sink], {
      staticFields: { timestamp: 'CLOBBERED', level: 'CLOBBERED', message: 'CLOBBERED', severity_number: 0 },
    });

    transport.log(makeLogRecord());

    const entry = sink.entries[0];
    expect(entry.timestamp).toBe('2026-03-31T14:00:00.000Z');
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('test message');
    expect(entry.severity_number).toBe(9);
  });

  it('should not break if onEntry throws', () => {
    const sink = createMockSink();
    const transport = new StructuredLogTransport([sink]);
    transport.onEntry = () => {
      throw new Error('listener error');
    };

    transport.log(makeLogRecord());

    expect(sink.entries).toHaveLength(1);
  });
});
