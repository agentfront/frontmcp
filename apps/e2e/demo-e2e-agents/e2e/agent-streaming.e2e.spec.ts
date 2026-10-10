/**
 * E2E: `execution.enableStreaming` streams the agent model's text (#698).
 *
 * The storyteller agent's mock model streams a sentence, calls a tool mid-stream, then streams the
 * story. A call with a progress token gets each chunk as a `notifications/progress` on that token; a
 * call without one gets no notification. The result is the same either way.
 */
import { expect, test } from '@frontmcp/testing';

interface ProgressParams {
  progressToken?: string | number;
  progress: number;
  total?: number;
  message?: string;
}

/** What `mcp.notifications.collect()` records. */
interface Collector {
  readonly received: Array<{ method: string; params?: unknown }>;
}

/** The progress notifications on `token` so far. */
function progressOn(notifications: Collector, token: string): ProgressParams[] {
  return notifications.received
    .filter((notification) => notification.method === 'notifications/progress')
    .map((notification) => notification.params as ProgressParams)
    .filter((params) => params.progressToken === token);
}

/**
 * The progress notifications on `token` once `count` arrived, or after `timeoutMs`: the server sends
 * them on the session's notification stream, which the client reads apart from the call's response.
 */
async function waitForProgress(
  notifications: Collector,
  token: string,
  count: number,
  timeoutMs = 5000,
): Promise<ProgressParams[]> {
  const deadline = Date.now() + timeoutMs;
  while (progressOn(notifications, token).length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return progressOn(notifications, token);
}

test.describe('Agent streaming E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-agents/src/main.ts',
    project: 'demo-e2e-agents',
    publicMode: true,
  });

  test('sends each chunk of the text as a progress notification, across a tool call', async ({ mcp }) => {
    const notifications = mcp.notifications.collect();

    const result = await mcp.tools.call('invoke_storyteller-agent', { topic: 'Tide' }, { progressToken: 'story-e2e' });

    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('The Tide: once upon a time.');
    expect(await waitForProgress(notifications, 'story-e2e', 5)).toEqual([
      { progressToken: 'story-e2e', progress: 1, message: 'Let me find ' },
      { progressToken: 'story-e2e', progress: 2, message: 'a story. ' },
      { progressToken: 'story-e2e', progress: 3, message: 'The Tide: ' },
      { progressToken: 'story-e2e', progress: 4, message: 'once upon ' },
      { progressToken: 'story-e2e', progress: 5, message: 'a time.' },
    ]);
  });

  test('sends no progress, and answers the same, without a progress token', async ({ mcp }) => {
    const notifications = mcp.notifications.collect();
    const progressCount = () => notifications.received.filter((n) => n.method === 'notifications/progress').length;
    const before = progressCount();

    const result = await mcp.tools.call('invoke_storyteller-agent', { topic: 'Tide' });
    // Give a notification the server might have sent time to arrive on the notification stream
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent('The Tide: once upon a time.');
    expect(progressCount()).toBe(before);
  });
});
