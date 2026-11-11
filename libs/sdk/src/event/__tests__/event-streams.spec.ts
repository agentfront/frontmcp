import { createMemoryStorage, type NamespacedStorage } from '@frontmcp/utils';

import { EventBuffer } from '../poll/event-buffer';
import { type EventStream } from '../stream/event-stream';
import { EVENT_RELAY_CHANNEL, EventStreams, MAX_OPEN_STREAMS } from '../stream/event-streams';

function occurrence(name: string, id: string) {
  return { eventId: id, name, timestamp: '2026-11-10T10:00:00.000Z', data: { id } };
}

/** A stand-in for an open stream: it records what it is offered and can be closed. */
function fakeStream(eventName: string, principalKey?: string) {
  const closeListeners: Array<() => void> = [];
  const stream = {
    eventName,
    principalKey,
    offer: jest.fn().mockResolvedValue(undefined),
    onClose: (listener: () => void) => closeListeners.push(listener),
    close: jest.fn(() => closeListeners.splice(0).forEach((listener) => listener())),
  };
  return stream as unknown as EventStream & { offer: jest.Mock; close: jest.Mock };
}

async function sharedStorage(): Promise<NamespacedStorage> {
  const storage = createMemoryStorage({ prefix: 'spec:events:' });
  await storage.connect();
  return storage;
}

function hub(storage?: NamespacedStorage, maxPerPrincipal = 100) {
  const buffer = new EventBuffer({ maxAgeMs: 600_000, maxEvents: 100 });
  const warn = jest.fn();
  const streams = new EventStreams({ buffer, maxPerPrincipal, storage, logger: { child: () => ({ warn }) } as never });
  return { streams, buffer, warn };
}

/** Lets a published message reach its subscribers. */
async function relayed(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe('EventStreams', () => {
  it('offers a published occurrence to the open streams of its event', async () => {
    const { streams, buffer } = hub();
    const orders = fakeStream('order.created');
    const moreOrders = fakeStream('order.created');
    const shipments = fakeStream('order.shipped');
    for (const stream of [orders, moreOrders, shipments]) streams.add(stream);
    const buffered = buffer.append(occurrence('order.created', 'evt_1'));

    await streams.publish(buffered);
    await streams.publish(buffer.append(occurrence('order.refunded', 'evt_2')));

    expect(orders.offer).toHaveBeenCalledWith(buffered);
    expect(moreOrders.offer).toHaveBeenCalledTimes(1);
    expect(shipments.offer).not.toHaveBeenCalled();
    expect(streams.size).toBe(3);
  });

  it('forgets a stream when it closes', async () => {
    const { streams, buffer } = hub();
    const stream = fakeStream('order.created');
    streams.add(stream);

    stream.close();
    await streams.publish(buffer.append(occurrence('order.created', 'evt_1')));

    expect(stream.offer).not.toHaveBeenCalled();
    expect(streams.size).toBe(0);
  });

  it('is full for an owner at maxPerPrincipal, and for everyone at the process limit', () => {
    const { streams } = hub(undefined, 2);
    streams.add(fakeStream('order.created', 'principal:ada'));
    expect(streams.isFull('principal:ada')).toBe(false);

    streams.add(fakeStream('order.shipped', 'principal:ada'));
    streams.add(fakeStream('order.shipped'));

    expect(streams.isFull('principal:ada')).toBe(true);
    expect(streams.isFull('principal:bob')).toBe(false);
    expect(streams.isFull(undefined)).toBe(false);

    for (let index = streams.size; index < MAX_OPEN_STREAMS; index++) streams.add(fakeStream('order.created'));
    expect(streams.isFull(undefined)).toBe(true);
  });

  it('closes every open stream when it stops', async () => {
    const { streams } = hub();
    const one = fakeStream('order.created');
    const other = fakeStream('order.shipped');
    streams.add(one);
    streams.add(other);

    await streams.stop();

    expect(one.close).toHaveBeenCalledTimes(1);
    expect(other.close).toHaveBeenCalledTimes(1);
    expect(streams.size).toBe(0);
  });

  describe('without a storage that can relay', () => {
    it('delivers in this process only', async () => {
      const { streams } = hub();

      await streams.start();

      expect(streams.isRelayed).toBe(false);
    });
  });

  describe('with a storage that can relay', () => {
    it('relays what one process publishes to the streams and the buffer of another, once', async () => {
      const storage = await sharedStorage();
      const publishing = hub(storage);
      const listening = hub(storage);
      await publishing.streams.start();
      await listening.streams.start();
      const local = fakeStream('order.created');
      const remote = fakeStream('order.created');
      publishing.streams.add(local);
      listening.streams.add(remote);
      const cursor = listening.buffer.currentCursor();

      const audience = { roles: { any: ['admin'] } };
      await publishing.streams.publish(
        publishing.buffer.append(occurrence('order.created', 'evt_1'), audience, 'sub_1'),
      );
      await relayed();

      expect(publishing.streams.isRelayed).toBe(true);
      expect(local.offer).toHaveBeenCalledTimes(1);
      expect(remote.offer).toHaveBeenCalledTimes(1);
      expect(remote.offer.mock.calls[0][0]).toMatchObject({
        occurrence: occurrence('order.created', 'evt_1'),
        audience,
        subscriptionId: 'sub_1',
      });
      expect(listening.buffer.read('order.created', cursor).events).toHaveLength(1);
      await publishing.streams.stop();
      await listening.streams.stop();
    });

    it('ignores a message that is not an occurrence, and stops listening when it stops', async () => {
      const storage = await sharedStorage();
      const { streams, buffer } = hub(storage);
      await streams.start();
      const stream = fakeStream('order.created');
      streams.add(stream);
      const cursor = buffer.currentCursor();

      await storage.publish(EVENT_RELAY_CHANNEL, 'not json');
      await storage.publish(EVENT_RELAY_CHANNEL, JSON.stringify({ origin: 'another-node' }));
      await storage.publish(EVENT_RELAY_CHANNEL, 'null');
      const malformed = { origin: 'another-node', occurrence: { name: 'order.created', data: {} } };
      await storage.publish(EVENT_RELAY_CHANNEL, JSON.stringify(malformed));
      await relayed();
      expect(stream.offer).not.toHaveBeenCalled();
      expect(buffer.read('order.created', cursor).events).toHaveLength(0);

      await streams.stop();
      const relay = { origin: 'another-node', occurrence: occurrence('order.created', 'evt_1') };
      await storage.publish(EVENT_RELAY_CHANNEL, JSON.stringify(relay));
      await relayed();

      expect(buffer.read('order.created', cursor).events).toHaveLength(0);
    });

    it('logs an occurrence it could not relay, and one it could not deliver', async () => {
      const storage = await sharedStorage();
      const { streams, buffer, warn } = hub(storage);
      await streams.start();
      const publishFailure = new Error('pub/sub down');
      jest.spyOn(storage, 'publish').mockRejectedValueOnce(publishFailure);

      await streams.publish(buffer.append(occurrence('order.created', 'evt_1')));

      expect(warn).toHaveBeenCalledWith('Event "order.created" was not relayed to the other processes', publishFailure);

      const failing = fakeStream('order.created');
      const deliveryFailure = new Error('stream failed');
      failing.offer.mockRejectedValue(deliveryFailure);
      streams.add(failing);
      const relay = { origin: 'another-node', occurrence: occurrence('order.created', 'evt_2') };
      await storage.publish(EVENT_RELAY_CHANNEL, JSON.stringify(relay));
      await relayed();

      expect(warn).toHaveBeenCalledWith('A relayed event was not delivered', deliveryFailure);
      await streams.stop();
    });
  });
});
