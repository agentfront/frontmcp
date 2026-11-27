import { type HttpOutput } from '../../../common/schemas/http-output.schema';
import { type Scope } from '../../../scope';
import { renderHttpOutputToWebResponse } from '../../web-response.renderer';
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

describe('a subscriptions/listen stream with resource subscriptions', () => {
  it('counts each URI on the registry while it is open, and stops counting when it closes', () => {
    const resources = { subscribe: jest.fn(() => () => undefined), watchUri: jest.fn(), unwatchUri: jest.fn() };
    const controller = new AbortController();

    createSubscriptionStream({
      scope: { resources } as unknown as Scope,
      subscriptionId: 'listen-1',
      requested: { resourceSubscriptions: ['board://status', 'tables://'] },
      signal: controller.signal,
    });
    expect(resources.watchUri.mock.calls).toEqual([['board://status'], ['tables://']]);
    expect(resources.unwatchUri).not.toHaveBeenCalled();
    controller.abort();

    expect(resources.unwatchUri.mock.calls).toEqual([['board://status'], ['tables://']]);
  });
});

describe('a subscriptions/listen stream with keep-alives off', () => {
  it('releases its registry listeners as soon as a web response reader cancels, with no update to wake it', async () => {
    const release = jest.fn();
    const { stream } = createSubscriptionStream({
      scope: scopeWithListChangingTools(release),
      subscriptionId: 'listen-1',
      requested: { toolsListChanged: true },
      signal: new AbortController().signal,
      keepAliveMs: 0,
    });
    const response = renderHttpOutputToWebResponse({
      kind: 'sse',
      status: 200,
      stream,
      contentType: 'text/event-stream',
      disposition: 'inline',
    } as HttpOutput);
    const reader = (response?.body as ReadableStream<Uint8Array>).getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('notifications/subscriptions/acknowledged');

    // The client reads on, so the stream is waiting for an update when it cancels.
    const waiting = reader.read();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const cancelled = reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(release).toHaveBeenCalledTimes(1);
    expect(await waiting).toEqual({ value: undefined, done: true });
    await cancelled;
  });
});
