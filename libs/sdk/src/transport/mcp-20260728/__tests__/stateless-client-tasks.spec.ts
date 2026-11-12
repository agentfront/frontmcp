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
