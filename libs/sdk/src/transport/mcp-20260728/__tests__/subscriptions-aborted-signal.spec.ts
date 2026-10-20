import { type Scope } from '../../../scope';
import { createSubscriptionStream } from '../subscriptions';

function scopeWithListChangingTools(release: () => void): Scope {
  return {
    tools: {
      getCapabilities: () => ({ tools: { listChanged: true } }),
      subscribe: () => release,
    },
  } as unknown as Scope;
}

async function readAll(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  for await (const chunk of stream) text += decoder.decode(chunk);
  return text;
}

describe('a subscriptions/listen stream whose signal is already aborted', () => {
  it('releases its registry listeners without being read', () => {
    const release = jest.fn();
    const controller = new AbortController();
    controller.abort();

    createSubscriptionStream({
      scope: scopeWithListChangingTools(release),
      subscriptionId: 'listen-1',
      requested: { toolsListChanged: true },
      signal: controller.signal,
    });

    expect(release).toHaveBeenCalledTimes(1);
  });

  it('ends after the acknowledgement', async () => {
    const controller = new AbortController();
    controller.abort();

    const { stream } = createSubscriptionStream({
      scope: scopeWithListChangingTools(jest.fn()),
      subscriptionId: 'listen-1',
      requested: { toolsListChanged: true },
      signal: controller.signal,
    });
    const events = (await readAll(stream)).split('\n\n').filter(Boolean);

    expect(events).toHaveLength(1);
    expect(events[0]).toContain('notifications/subscriptions/acknowledged');
  });
});
