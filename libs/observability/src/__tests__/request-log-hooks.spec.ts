/**
 * `requestLogs.onRequestComplete` fires (#766): the HTTP flow opens the request's log when it starts
 * tracing the request, the entry flows name what it served and record a failure, and the HTTP
 * finalize closes it, which fires the callback once.
 */
import {
  completeRequestLog,
  currentRequestLog,
  recordRequestLogFailure,
  startRequestLog,
} from '../request-log/request-log.hooks';

function requestFlow() {
  const store = new Map<symbol, unknown>();
  const context = {
    requestId: 'req-1',
    sessionId: 'session-1',
    scopeId: 'root',
    traceContext: { traceId: 'trace-1' },
    get: (key: symbol) => store.get(key),
    set: (key: symbol, value: unknown) => store.set(key, value),
  };
  const get = (token: unknown) => (token === Symbol.for('frontmcp:CONTEXT') ? context : undefined);
  return {
    http: {
      get,
      rawInput: { request: { method: 'POST', path: '/mcp', body: { method: 'tools/call' } } },
      state: {} as Record<string | symbol, unknown>,
    },
    tool: { get, state: {} as Record<string | symbol, unknown> },
  };
}

describe('request log hooks', () => {
  it('fires onRequestComplete once with what the request served', async () => {
    const onRequestComplete = jest.fn();
    const { http, tool } = requestFlow();

    startRequestLog(http, { onRequestComplete });
    currentRequestLog(tool)?.setToolName('search');
    await completeRequestLog(http);
    await completeRequestLog(http);

    expect(onRequestComplete).toHaveBeenCalledTimes(1);
    expect(onRequestComplete.mock.calls[0][0]).toMatchObject({
      request_id: 'req-1',
      tool_name: 'search',
      status: 'ok',
    });
  });

  it("records an entry flow's failure and the HTTP error status", async () => {
    const onRequestComplete = jest.fn();
    const { http, tool } = requestFlow();

    startRequestLog(http, { onRequestComplete });
    tool.state['flowError'] = new Error('tool crashed');
    recordRequestLogFailure(tool);
    http.state['statusCode'] = 500;
    await completeRequestLog(http);

    expect(onRequestComplete.mock.calls[0][0]).toMatchObject({
      status: 'error',
      error: { type: 'Error', message: 'tool crashed' },
    });
  });
});
