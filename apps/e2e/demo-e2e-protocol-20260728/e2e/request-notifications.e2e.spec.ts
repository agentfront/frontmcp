/**
 * Request-scoped notifications, log-level opt-in, OTel context, and ordering.
 *
 * 2026-07-28 removed `logging/setLevel`: a client opts into log messages per
 * request via `_meta` `logLevel`, and a server MUST NOT emit any for a request
 * that omitted it. Progress and log frames ride the response stream of the
 * request they relate to.
 */
import { expect, test } from '@frontmcp/testing';

import { mcpStatelessFetch, META_SERVER_INFO, parseSseEvents, type ListedTool } from './helpers/mcp-stateless-client';

const CHATTY = {
  method: 'tools/call' as const,
  params: { name: 'chatty', arguments: { steps: 3 } },
};

/** Parse the SSE frames of a buffered response into JSON-RPC messages. */
function messagesOf(text: string): any[] {
  return parseSseEvents(text).map((payload) => JSON.parse(payload));
}

test.describe('protocol 2026-07-28 — request-scoped notifications', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-protocol-20260728/src/main.ts',
    project: 'demo-e2e-protocol-20260728',
    publicMode: true,
  });

  test('emits no notifications/message when logLevel is absent', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, { ...CHATTY, id: 1, accept: 'text/event-stream' });

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('notifications/message');
    expect(res.json().result.resultType).toBe('complete');
  });

  test('streams notifications/message when logLevel is set', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      ...CHATTY,
      id: 2,
      logLevel: 'debug',
      accept: 'application/json, text/event-stream',
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const messages = messagesOf(res.text);
    const logs = messages.filter((m) => m.method === 'notifications/message');
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs)).toContain('finished step 1');
  });

  test('honours the requested minimum severity', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      ...CHATTY,
      id: 3,
      logLevel: 'warning',
      accept: 'application/json, text/event-stream',
    });

    const logs = messagesOf(res.text).filter((m) => m.method === 'notifications/message');
    // The tool logs at debug, info and warning — only the warning qualifies.
    expect(logs.length).toBe(1);
    expect(logs[0].params.level).toBe('warning');
    expect(JSON.stringify(logs[0])).toContain('all done');
  });

  test('terminates the stream with the final response', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      ...CHATTY,
      id: 4,
      logLevel: 'debug',
      accept: 'application/json, text/event-stream',
    });

    const messages = messagesOf(res.text);
    const last = messages[messages.length - 1];
    expect(last.id).toBe(4);
    expect(last.result.resultType).toBe('complete');
    expect(last.error).toBeUndefined();
  });

  test('streams notifications/progress when a progressToken is supplied', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      ...CHATTY,
      id: 5,
      meta: { progressToken: 'tok-1' },
      accept: 'application/json, text/event-stream',
    });

    const progress = messagesOf(res.text).filter((m) => m.method === 'notifications/progress');
    expect(progress.length).toBe(3);
    expect(progress[0].params.progressToken).toBe('tok-1');
    expect(progress[0].params.total).toBe(3);
    expect(progress.map((p) => p.params.progress)).toEqual([1, 2, 3]);
  });

  test('emits no progress when no progressToken was supplied', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, { ...CHATTY, id: 6, accept: 'text/event-stream' });
    expect(res.text).not.toContain('notifications/progress');
  });

  test('falls back to a buffered JSON response when the client will not take SSE', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      ...CHATTY,
      id: 7,
      logLevel: 'debug',
      accept: 'application/json',
    });

    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.json().result.resultType).toBe('complete');
  });
});

test.describe('protocol 2026-07-28 — OpenTelemetry context', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-protocol-20260728/src/main.ts',
    project: 'demo-e2e-protocol-20260728',
    publicMode: true,
  });

  const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

  test('echoes traceparent back on the result _meta', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'tools/list',
      id: 8,
      meta: { traceparent: TRACEPARENT },
    });

    const { result } = res.json();
    expect(result._meta.traceparent).toBe(TRACEPARENT);
    // serverInfo must survive alongside the trace keys.
    expect(result._meta[META_SERVER_INFO]).toBeDefined();
  });

  test('echoes tracestate and baggage', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, {
      method: 'tools/list',
      id: 9,
      meta: { traceparent: TRACEPARENT, tracestate: 'vendor=abc', baggage: 'tenant=acme' },
    });

    const { result } = res.json();
    expect(result._meta.tracestate).toBe('vendor=abc');
    expect(result._meta.baggage).toBe('tenant=acme');
  });

  test('omits the trace keys entirely when the client sent none', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, { method: 'tools/list', id: 10 });

    const { result } = res.json();
    expect(result._meta.traceparent).toBeUndefined();
    expect(result._meta.tracestate).toBeUndefined();
    expect(result._meta.baggage).toBeUndefined();
  });
});

test.describe('protocol 2026-07-28 — deterministic list ordering', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-protocol-20260728/src/main.ts',
    project: 'demo-e2e-protocol-20260728',
    publicMode: true,
  });

  test('returns tools sorted by name', async ({ server }) => {
    const res = await mcpStatelessFetch(server.info.baseUrl, { method: 'tools/list', id: 11 });
    const names = (res.json().result.tools as ListedTool[]).map((t) => t.name);

    expect(names).toEqual([...names].sort());
  });

  test('returns prompts and resources in a stable order too', async ({ server }) => {
    for (const [index, method] of ['prompts/list', 'resources/list'].entries()) {
      const first = await mcpStatelessFetch(server.info.baseUrl, { method, id: 20 + index });
      const second = await mcpStatelessFetch(server.info.baseUrl, { method, id: 30 + index });
      expect(JSON.stringify(first.json().result)).toBe(JSON.stringify(second.json().result));
    }
  });
});
