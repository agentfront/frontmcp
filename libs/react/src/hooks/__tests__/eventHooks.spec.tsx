import { act, renderHook, waitFor } from '@testing-library/react';

import type { DirectClient, DirectMcpServer, EventOccurrence, EventSubscription } from '@frontmcp/sdk';

import { serverRegistry } from '../../registry/ServerRegistry';
import { useDomEventSource } from '../useDomEventSource';
import { useEventSubscription } from '../useEventSubscription';
import { usePublishEvent } from '../usePublishEvent';

/** A subscription the test feeds: `push` yields an occurrence, `end` completes or fails the iteration. */
function controllableSubscription(mode: EventSubscription['mode'] = 'push') {
  const queue: EventOccurrence[] = [];
  let wake: (() => void) | undefined;
  let ended = false;
  let failure: Error | undefined;
  const cancel = jest.fn(async () => {
    ended = true;
    wake?.();
  });
  const subscription = {
    name: 'order.created',
    arguments: {},
    mode,
    cursor: null,
    id: undefined,
    deliveryStatus: undefined,
    cancel,
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const next = queue.shift();
        if (next) {
          yield next;
          continue;
        }
        if (failure) throw failure;
        if (ended) return;
        await new Promise<void>((resolve) => (wake = resolve));
      }
    },
  } as unknown as EventSubscription;
  return {
    subscription,
    cancel,
    push(occurrence: EventOccurrence) {
      queue.push(occurrence);
      wake?.();
    },
    end(error?: Error) {
      ended = true;
      failure = error;
      wake?.();
    },
  };
}

const occurrence = (eventId: string): EventOccurrence => ({
  eventId,
  name: 'order.created',
  timestamp: '2026-11-10T10:00:00Z',
  data: { eventId },
});

/** Register a connected server whose client subscribes with `subscribe`, and whose publisher is `publish`. */
function registerServer(name: string, subscribe: jest.Mock, publish: jest.Mock = jest.fn()) {
  const client = { events: { subscribe } } as unknown as DirectClient;
  const server = { events: { publish } } as unknown as DirectMcpServer;
  serverRegistry.register(name, server);
  serverRegistry.update(name, { client, status: 'connected' });
  return { client, server };
}

describe('useEventSubscription', () => {
  beforeEach(() => serverRegistry.clear());

  it('subscribes once connected, runs the handler for each occurrence, and cancels on unmount', async () => {
    const feed = controllableSubscription();
    const subscribe = jest.fn().mockResolvedValue(feed.subscription);
    registerServer('default', subscribe);
    const seen: string[] = [];

    const { result, unmount } = renderHook(() =>
      useEventSubscription('order.created', { status: 'paid' }, (received) => seen.push(received.eventId)),
    );
    await waitFor(() => expect(result.current.status).toBe('active'));
    act(() => feed.push(occurrence('e1')));
    await waitFor(() => expect(seen).toEqual(['e1']));
    unmount();

    expect(subscribe).toHaveBeenCalledWith('order.created', { status: 'paid' }, { delivery: undefined });
    expect(result.current.mode).toBe('push');
    expect(feed.cancel).toHaveBeenCalled();
  });

  it('reports a refusal and a termination through onError', async () => {
    const onError = jest.fn();
    registerServer('refusing', jest.fn().mockRejectedValue('refused'));
    const feed = controllableSubscription('poll');
    registerServer('ending', jest.fn().mockResolvedValue(feed.subscription));

    const refused = renderHook(() =>
      useEventSubscription('order.created', undefined, { onEvent: jest.fn(), onError, server: 'refusing' }),
    );
    const ended = renderHook(() =>
      useEventSubscription('order.created', undefined, { onEvent: jest.fn(), onError, server: 'ending' }),
    );
    await waitFor(() => expect(refused.result.current.status).toBe('error'));
    await waitFor(() => expect(ended.result.current.status).toBe('active'));
    act(() => feed.end(new Error('terminated')));
    await waitFor(() => expect(ended.result.current.status).toBe('error'));

    expect(refused.result.current.error?.message).toBe('refused');
    expect(ended.result.current).toMatchObject({ mode: 'poll', error: new Error('terminated') });
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('says when the server ended the subscription, and holds none while disabled or not connected', async () => {
    const feed = controllableSubscription();
    const subscribe = jest.fn().mockResolvedValue(feed.subscription);
    registerServer('default', subscribe);

    const disabled = renderHook(() =>
      useEventSubscription('order.created', {}, { onEvent: jest.fn(), enabled: false }),
    );
    const unknown = renderHook(() => useEventSubscription('order.created', {}, { onEvent: jest.fn(), server: 'none' }));
    const live = renderHook(() => useEventSubscription('order.created', {}, jest.fn()));
    await waitFor(() => expect(live.result.current.status).toBe('active'));
    act(() => feed.end());
    await waitFor(() => expect(live.result.current.status).toBe('ended'));

    expect(disabled.result.current.status).toBe('idle');
    expect(unknown.result.current.status).toBe('idle');
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('cancels a subscription that resolves after unmount, and ignores its failure', async () => {
    const late = controllableSubscription();
    let resolveSubscribe: (subscription: EventSubscription) => void = () => undefined;
    let rejectSubscribe: (error: Error) => void = () => undefined;
    registerServer(
      'late',
      jest.fn(() => new Promise((resolve) => (resolveSubscribe = resolve))),
    );
    registerServer(
      'failing',
      jest.fn(() => new Promise((_resolve, reject) => (rejectSubscribe = reject))),
    );
    const onError = jest.fn();

    const first = renderHook(() => useEventSubscription('order.created', {}, { onEvent: jest.fn(), server: 'late' }));
    const second = renderHook(() =>
      useEventSubscription('order.created', {}, { onEvent: jest.fn(), onError, server: 'failing' }),
    );
    first.unmount();
    second.unmount();
    await act(async () => {
      resolveSubscribe(late.subscription);
      rejectSubscribe(new Error('late'));
    });

    expect(late.cancel).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('usePublishEvent', () => {
  beforeEach(() => serverRegistry.clear());

  it("publishes on the provider's server, and rejects without one", async () => {
    const publish = jest.fn().mockResolvedValue({ eventId: 'evt_1', matched: 2 });
    registerServer('default', jest.fn(), publish);

    const bound = renderHook(() => usePublishEvent()).result.current;
    const missing = renderHook(() => usePublishEvent('none')).result.current;

    await expect(bound('cart.updated', { items: 2 }, { eventId: 'evt_1' })).resolves.toEqual({
      eventId: 'evt_1',
      matched: 2,
    });
    expect(publish).toHaveBeenCalledWith('cart.updated', { items: 2 }, { eventId: 'evt_1' });
    await expect(missing('cart.updated', {})).rejects.toThrow('FrontMCP server "none" is not registered');
  });
});

describe('useDomEventSource', () => {
  beforeEach(() => serverRegistry.clear());

  it('publishes what a DOM event maps to, on the element of a ref, and stops on unmount', async () => {
    const publish = jest.fn().mockResolvedValue({ eventId: 'evt_1', matched: 0 });
    registerServer('default', jest.fn(), publish);
    const button = document.createElement('button');
    const ref = { current: button };

    const { unmount } = renderHook(() =>
      useDomEventSource<MouseEvent>(ref, 'click', (domEvent) =>
        domEvent.detail === 2 ? undefined : { name: 'button.clicked', data: { detail: domEvent.detail } },
      ),
    );
    button.dispatchEvent(new MouseEvent('click', { detail: 1 }));
    button.dispatchEvent(new MouseEvent('click', { detail: 2 }));
    unmount();
    button.dispatchEvent(new MouseEvent('click', { detail: 3 }));

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith('button.clicked', { detail: 1 }, undefined);
  });

  it('reports a failed publish to onError, or as a warning', async () => {
    const publish = jest.fn().mockRejectedValueOnce(new Error('not registered')).mockRejectedValue('not registered');
    registerServer('default', jest.fn(), publish);
    const target = new EventTarget();
    const onError = jest.fn();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    renderHook(() => useDomEventSource(target, 'ping', () => ({ name: 'pinged', data: {} }), { onError }));
    renderHook(() => useDomEventSource(target, 'ping', () => ({ name: 'pinged', data: {} })));
    target.dispatchEvent(new Event('ping'));
    await waitFor(() => expect(warn).toHaveBeenCalled());

    expect(onError).toHaveBeenCalledWith(new Error('not registered'));
    expect(warn.mock.calls[0][0]).toContain('event "pinged" was not published: not registered');
    warn.mockRestore();
  });

  it('listens to nothing without a target', () => {
    const toEvent = jest.fn();

    renderHook(() => useDomEventSource({ current: null }, 'click', toEvent));
    renderHook(() => useDomEventSource(null, 'click', toEvent));

    expect(toEvent).not.toHaveBeenCalled();
  });
});
