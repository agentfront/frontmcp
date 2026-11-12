/** The 2026-07-28 client polls a task handle no faster than 100 ms apart, and no longer than maxTaskWaitMs when set. */
import { McpStatelessClient, McpStatelessError } from '../client/mcp-stateless.client';

/** A remote whose tools/call answers a task handle that never settles, counting the polls it gets. */
function neverSettlingRemote(handle: Record<string, unknown>): { fetchImpl: typeof fetch; polls: { count: number } } {
  const polls = { count: 0 };
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id: number; method: string };
    if (body.method === 'tasks/get') polls.count++;
    const result =
      body.method === 'tools/call'
        ? { resultType: 'task', task: { taskId: 't1', status: 'working', ...handle } }
        : { taskId: 't1', status: 'working' };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetchImpl, polls };
}

describe('McpStatelessClient — task polling', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('waits at least 100 ms between polls, whatever pollIntervalMs the task handle states', async () => {
    const { fetchImpl, polls } = neverSettlingRemote({ pollIntervalMs: 0, ttlMs: 2_000 });
    const client = new McpStatelessClient({ url: 'http://remote.test/', fetchImpl });
    const call = client.callTool('slow').catch((error: unknown) => error);

    await jest.advanceTimersByTimeAsync(1_000);
    expect(polls.count).toBeLessThanOrEqual(10);

    await jest.advanceTimersByTimeAsync(2_000);
    await expect(call).resolves.toBeInstanceOf(McpStatelessError);
  });

  it('stops polling at maxTaskWaitMs, though the task handle states no time to live', async () => {
    const { fetchImpl, polls } = neverSettlingRemote({ pollIntervalMs: 250, ttlMs: null });
    const client = new McpStatelessClient({ url: 'http://remote.test/', fetchImpl, maxTaskWaitMs: 1_000 });
    let outcome: unknown;
    void client.callTool('slow').catch((error: unknown) => (outcome = error));

    await jest.advanceTimersByTimeAsync(1_500);
    const pollsAtDeadline = polls.count;
    await jest.advanceTimersByTimeAsync(5_000);

    expect(outcome).toEqual(expect.objectContaining({ message: 'Task t1 did not settle within 1000ms' }));
    expect(polls.count).toBe(pollsAtDeadline);
  });
});

describe('McpStatelessClient — SSE responses', () => {
  /** A response streaming one SSE frame in `pieces` chunks, with `\r\n\r\n` split across the last two. */
  function streamedFrame(pieces: number): typeof fetch {
    return (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const { id } = JSON.parse(String(init?.body)) as { id: number };
      const chunks = [`data: {"jsonrpc":"2.0","id":${id},"result":{"pad":"`];
      for (let piece = 0; piece < pieces; piece++) chunks.push('x'.repeat(1_024));
      chunks.push('"}}\r\n\r', '\n');
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          const next = chunks.shift();
          if (next === undefined) controller.close();
          else controller.enqueue(encoder.encode(next));
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as typeof fetch;
  }

  it('searches each character of a frame sent in many chunks for its end a bounded number of times', async () => {
    const pieces = 300;
    const client = new McpStatelessClient({ url: 'http://remote.test/', fetchImpl: streamedFrame(pieces) });
    let searched = 0;
    const search = String.prototype.search;
    const test = RegExp.prototype.test;
    jest.spyOn(String.prototype, 'search').mockImplementation(function (
      this: string,
      pattern: { [Symbol.search](value: string): number },
    ) {
      searched += this.length;
      return search.call(this, pattern);
    });
    jest.spyOn(RegExp.prototype, 'test').mockImplementation(function (this: RegExp, value: string) {
      searched += String(value).length;
      return test.call(this, value);
    });

    let result: Record<string, unknown>;
    try {
      result = await client.request('tools/call', { name: 'big' });
    } finally {
      jest.restoreAllMocks();
    }

    expect(String(result['pad'])).toHaveLength(pieces * 1_024);
    expect(searched).toBeLessThanOrEqual(3 * pieces * 1_024);
  });
});
