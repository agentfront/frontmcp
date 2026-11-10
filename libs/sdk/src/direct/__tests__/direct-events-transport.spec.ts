import { EventRequestError } from '../../event-client';
import { directEventsTransport, type ProtocolRequester } from '../direct-events-transport';

/** A protocol client whose next request id is `nextId`, answering with `answer`. */
function clientOf(answer: (signal?: AbortSignal) => Promise<unknown>, nextId: unknown = 4): ProtocolRequester {
  return Object.assign(
    { request: (_request: unknown, _schema: unknown, options?: { signal?: AbortSignal }) => answer(options?.signal) },
    { _requestMessageId: nextId },
  );
}

const noNotifications = () => () => undefined;

describe('directEventsTransport', () => {
  it('turns an MCP error into an EventRequestError without the protocol prefix', async () => {
    const transport = directEventsTransport(
      clientOf(() => Promise.reject({ code: -32023, message: 'MCP error -32023: Event "x" is not served', data: 1 })),
      noNotifications,
    );

    const error = await transport.request('events/poll', {}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EventRequestError);
    expect(error).toMatchObject({ rpcCode: -32023, data: 1, method: 'events/poll' });
    expect((error as Error).message).toBe('events/poll failed (-32023): Event "x" is not served');
  });

  it('passes on an error that carries no JSON-RPC code, and names a code without a message', async () => {
    const plain = directEventsTransport(
      clientOf(() => Promise.reject(new Error('closed'))),
      noNotifications,
    );
    const bare = directEventsTransport(
      clientOf(() => Promise.reject({ code: -32603 })),
      noNotifications,
    );
    const empty = directEventsTransport(
      clientOf(() => Promise.reject(undefined)),
      noNotifications,
    );

    await expect(plain.request('events/list', {})).rejects.toThrow('closed');
    await expect(bare.request('events/list', {})).rejects.toMatchObject({ rpcCode: -32603 });
    await expect(empty.request('events/list', {})).rejects.toBeUndefined();
  });

  it('routes the notifications of its own stream only, and stops listening when it ends', async () => {
    let listener: ((notification: { method: string; params?: unknown }) => void) | undefined;
    const stopped = jest.fn();
    const received: string[] = [];
    let finish: () => void = () => undefined;
    const transport = directEventsTransport(
      clientOf(() => new Promise((resolve) => (finish = () => resolve({})))),
      (handler) => {
        listener = handler;
        return stopped;
      },
    );

    const streaming = transport.openStream?.(
      { name: 'order.created' },
      (notification) => received.push(notification.method),
      new AbortController().signal,
    );
    listener?.({
      method: 'notifications/events/active',
      params: { _meta: { 'io.modelcontextprotocol/subscriptionId': 4 } },
    });
    listener?.({
      method: 'notifications/events/active',
      params: { _meta: { 'io.modelcontextprotocol/subscriptionId': 5 } },
    });
    listener?.({ method: 'notifications/message' });
    finish();
    await streaming;

    expect(received).toEqual(['notifications/events/active']);
    expect(stopped).toHaveBeenCalled();
  });

  it('resolves when the stream is aborted, and rejects a refusal', async () => {
    const controller = new AbortController();
    const aborting = directEventsTransport(
      clientOf(
        (signal) =>
          new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('cancelled')))),
      ),
      noNotifications,
    );
    const refusing = directEventsTransport(
      clientOf(() => Promise.reject({ code: -32024, message: 'Forbidden' })),
      noNotifications,
    );

    const streaming = aborting.openStream?.({}, () => undefined, controller.signal);
    controller.abort();

    await expect(streaming).resolves.toBeUndefined();
    await expect(refusing.openStream?.({}, () => undefined, new AbortController().signal)).rejects.toMatchObject({
      rpcCode: -32024,
    });
  });

  it('cannot stream on a protocol client that does not number its requests', async () => {
    const transport = directEventsTransport(
      clientOf(() => Promise.resolve({}), null),
      noNotifications,
    );

    await expect(transport.openStream?.({}, () => undefined, new AbortController().signal)).rejects.toThrow(
      'cannot hold an events/stream',
    );
  });
});
