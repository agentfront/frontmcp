import { RequestLogCollector } from '../request-log/request-log.collector';
import type { StructuredLogEntry } from '../logging/structured-log.types';

function makeContext() {
  return {
    requestId: 'req-001',
    traceId: 'trace-001',
    sessionIdHash: 'hash12345678',
    scopeId: 'test-scope',
  };
}

function makeEntry(overrides?: Partial<StructuredLogEntry>): StructuredLogEntry {
  return {
    timestamp: '2026-03-31T14:00:00.000Z',
    level: 'info',
    severity_number: 9,
    message: 'test',
    ...overrides,
  };
}

describe('RequestLogCollector', () => {
  it('should accumulate entries', () => {
    const collector = new RequestLogCollector(makeContext());
    collector.addEntry(makeEntry({ message: 'first' }));
    collector.addEntry(makeEntry({ message: 'second' }));
    expect(collector.getEntryCount()).toBe(2);
  });

  it('should respect maxEntries limit', () => {
    const collector = new RequestLogCollector(makeContext(), { maxEntries: 2 });
    collector.addEntry(makeEntry({ message: '1' }));
    collector.addEntry(makeEntry({ message: '2' }));
    collector.addEntry(makeEntry({ message: '3' })); // Should be dropped
    expect(collector.getEntryCount()).toBe(2);
  });

  it('should track hooks triggered', () => {
    const collector = new RequestLogCollector(makeContext());
    collector.addHook('willExecute');
    collector.addHook('didExecute');
    collector.addHook('willExecute'); // Duplicate

    const log = collector.toRequestLog();
    expect(log.hooks_triggered).toEqual(['willExecute', 'didExecute']);
  });

  it('should set HTTP info', () => {
    const collector = new RequestLogCollector(makeContext());
    collector.setHttpInfo('POST', '/mcp');

    const log = collector.toRequestLog();
    expect(log.http_method).toBe('POST');
    expect(log.http_path).toBe('/mcp');
  });

  it('should set RPC method', () => {
    const collector = new RequestLogCollector(makeContext());
    collector.setRpcMethod('tools/call');
    expect(collector.toRequestLog().rpc_method).toBe('tools/call');
  });

  it('should set tool name', () => {
    const collector = new RequestLogCollector(makeContext());
    collector.setToolName('get_weather');
    expect(collector.toRequestLog().tool_name).toBe('get_weather');
  });

  it('should set resource URI', () => {
    const collector = new RequestLogCollector(makeContext());
    collector.setResourceUri('file:///data.txt');
    expect(collector.toRequestLog().resource_uri).toBe('file:///data.txt');
  });

  it('should set prompt name', () => {
    const collector = new RequestLogCollector(makeContext());
    collector.setPromptName('summarize');
    expect(collector.toRequestLog().prompt_name).toBe('summarize');
  });

  it('should set auth info', () => {
    const collector = new RequestLogCollector(makeContext());
    collector.setAuthInfo('bearer', true);
    const log = collector.toRequestLog();
    expect(log.auth_type).toBe('bearer');
    expect(log.authenticated).toBe(true);
  });

  it('should default authenticated to false', () => {
    const collector = new RequestLogCollector(makeContext());
    expect(collector.toRequestLog().authenticated).toBe(false);
  });

  it('should set status and status code', () => {
    const collector = new RequestLogCollector(makeContext());
    collector.setStatus('error', 500);
    const log = collector.toRequestLog();
    expect(log.status).toBe('error');
    expect(log.status_code).toBe(500);
  });

  it('should set error details and auto-set status', () => {
    const collector = new RequestLogCollector(makeContext());
    collector.setError({
      type: 'ToolNotFoundError',
      message: 'Tool not found: foo',
      code: '-32002',
      error_id: 'err-123',
    });
    const log = collector.toRequestLog();
    expect(log.status).toBe('error');
    expect(log.error).toEqual({
      type: 'ToolNotFoundError',
      message: 'Tool not found: foo',
      code: '-32002',
      error_id: 'err-123',
    });
  });

  it('should produce a complete RequestLog', () => {
    const collector = new RequestLogCollector(makeContext());
    collector.setHttpInfo('POST', '/mcp');
    collector.setRpcMethod('tools/call');
    collector.setToolName('get_weather');
    collector.setAuthInfo('bearer', true);
    collector.setStatus('ok', 200);
    collector.addHook('willExecute');
    collector.addEntry(makeEntry({ message: 'executing tool', flow_name: 'tools:call-tool' }));

    const log = collector.toRequestLog();

    expect(log.request_id).toBe('req-001');
    expect(log.trace_id).toBe('trace-001');
    expect(log.scope_id).toBe('test-scope');
    expect(log.start_time).toBeTruthy();
    expect(log.end_time).toBeTruthy();
    expect(log.duration_ms).toBeGreaterThanOrEqual(0);
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0].message).toBe('executing tool');
    expect(log.entries[0].stage).toBe('tools:call-tool');
  });

  it('should fire onRequestComplete callback on finalize', async () => {
    const onComplete = jest.fn();
    const collector = new RequestLogCollector(makeContext(), { onRequestComplete: onComplete });
    collector.addEntry(makeEntry());

    const log = await collector.finalize();

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(log);
  });

  it('should only finalize once', async () => {
    const onComplete = jest.fn();
    const collector = new RequestLogCollector(makeContext(), { onRequestComplete: onComplete });

    await collector.finalize();
    await collector.finalize(); // Second call

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(collector.isFinalized()).toBe(true);
  });

  it('should not add entries after finalization', async () => {
    const collector = new RequestLogCollector(makeContext());
    await collector.finalize();
    collector.addEntry(makeEntry({ message: 'late entry' }));
    expect(collector.getEntryCount()).toBe(0);
  });

  it('should handle callback errors gracefully', async () => {
    const onComplete = jest.fn().mockRejectedValue(new Error('callback failed'));
    const collector = new RequestLogCollector(makeContext(), { onRequestComplete: onComplete });

    // Should not throw
    const log = await collector.finalize();
    expect(log).toBeTruthy();
    expect(log.request_id).toBe('req-001');
  });

  it('should include entry attributes when present', () => {
    const collector = new RequestLogCollector(makeContext());
    collector.addEntry(makeEntry({ attributes: { key: 'value' } }));
    const log = collector.toRequestLog();
    expect(log.entries[0].attributes).toEqual({ key: 'value' });
  });

  it('should omit entry attributes when empty', () => {
    const collector = new RequestLogCollector(makeContext());
    collector.addEntry(makeEntry());
    const log = collector.toRequestLog();
    expect(log.entries[0].attributes).toBeUndefined();
  });

  it('should include elapsed_ms when present', () => {
    const collector = new RequestLogCollector(makeContext());
    collector.addEntry(makeEntry({ elapsed_ms: 42 }));
    const log = collector.toRequestLog();
    expect(log.entries[0].elapsed_ms).toBe(42);
  });
});
