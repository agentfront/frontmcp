/**
 * `createChangeFeed()`: topics that tell their listeners they changed, in this process and in others.
 */
import { MemoryStorageAdapter } from '../adapters/memory';
import {
  createChangeFeed,
  DEFAULT_CHANGE_FEED_COALESCE_MS,
  DEFAULT_CHANGE_FEED_POLL_INTERVAL_MS,
  type ChangeFeed,
} from '../change-feed';
import { createRootStorage } from '../namespace';
import type { MessageHandler, NamespacedStorage, StorageAdapter } from '../types';

const POLL_MS = 100;
const COALESCE_MS = 20;

/** A storage without pub/sub, like SQLite's: `dataVersion()` moves when the test says another process wrote. */
function pollingStorage(): { storage: NamespacedStorage; otherProcessWrote(): void; adapter: MemoryStorageAdapter } {
  const adapter = new MemoryStorageAdapter({ enableSweeper: false });
  let version = 1;
  Object.assign(adapter, { supportsPubSub: () => false, dataVersion: async () => version });
  return { adapter, storage: createRootStorage(adapter), otherProcessWrote: () => version++ };
}

describe('createChangeFeed()', () => {
  const feeds: ChangeFeed[] = [];
  const open = (storage: NamespacedStorage, onError?: (error: unknown) => void): ChangeFeed => {
    const feed = createChangeFeed(storage, { pollIntervalMs: POLL_MS, coalesceMs: COALESCE_MS, onError });
    feeds.push(feed);
    return feed;
  };

  beforeEach(() => jest.useFakeTimers());

  afterEach(async () => {
    for (const feed of feeds.splice(0)) await feed.close();
    jest.useRealTimers();
  });

  it('picks pub/sub, a data_version poll, or this process only, from what the storage can do', async () => {
    const memory = new MemoryStorageAdapter({ enableSweeper: false });
    await memory.connect();
    const local = { supportsPubSub: () => false } as unknown as StorageAdapter;

    expect(open(createRootStorage(memory)).kind).toBe('pubsub');
    expect(open(pollingStorage().storage).kind).toBe('poll');
    expect(open(createRootStorage(local)).kind).toBe('local');
    await memory.disconnect();
  });

  describe('over pub/sub', () => {
    it('tells the listeners of a topic once for a burst of publishes', async () => {
      const memory = new MemoryStorageAdapter({ enableSweeper: false });
      await memory.connect();
      const feed = open(createRootStorage(memory));
      const board = jest.fn();
      const other = jest.fn();
      feed.subscribe('board', board);
      feed.subscribe('other', other);
      await jest.advanceTimersByTimeAsync(0);

      for (let i = 0; i < 5; i++) await feed.publish('board');
      await jest.advanceTimersByTimeAsync(COALESCE_MS);

      expect(board).toHaveBeenCalledTimes(1);
      expect(other).not.toHaveBeenCalled();
      await memory.disconnect();
    });

    it("publishes on the namespaced channel, and a message on it reaches this process's listeners", async () => {
      const handlers = new Map<string, MessageHandler>();
      const released: string[] = [];
      const adapter = {
        supportsPubSub: () => true,
        publish: jest.fn(async () => 1),
        subscribe: jest.fn(async (channel: string, handler: MessageHandler) => {
          handlers.set(channel, handler);
          return async () => void released.push(channel);
        }),
      } as unknown as StorageAdapter;
      const feed = open(createRootStorage(adapter).namespace('lens'));
      const listener = jest.fn();
      const unsubscribe = feed.subscribe('board', listener);
      await jest.advanceTimersByTimeAsync(0);

      await feed.publish('board');
      handlers.get('lens:feed:board')?.('', 'lens:feed:board');
      await jest.advanceTimersByTimeAsync(COALESCE_MS);
      unsubscribe();
      await jest.advanceTimersByTimeAsync(0);

      expect(adapter.publish).toHaveBeenCalledWith('lens:feed:board', '');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(released).toEqual(['lens:feed:board']);
    });

    it('reports a channel it could not leave', async () => {
      const onError = jest.fn();
      const adapter = {
        supportsPubSub: () => true,
        subscribe: jest.fn(async () => async () => {
          throw new Error('connection closed');
        }),
      } as unknown as StorageAdapter;
      const feed = open(createRootStorage(adapter), onError);

      const unsubscribe = feed.subscribe('board', jest.fn());
      await jest.advanceTimersByTimeAsync(0);
      unsubscribe();
      await jest.advanceTimersByTimeAsync(0);

      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'connection closed' }));
    });

    it('reports a channel it could not subscribe to', async () => {
      const onError = jest.fn();
      const adapter = {
        supportsPubSub: () => true,
        subscribe: jest.fn(async () => {
          throw new Error('redis is down');
        }),
      } as unknown as StorageAdapter;
      const feed = open(createRootStorage(adapter), onError);

      const unsubscribe = feed.subscribe('board', jest.fn());
      await jest.advanceTimersByTimeAsync(0);
      unsubscribe();
      await jest.advanceTimersByTimeAsync(0);

      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'redis is down' }));
    });
  });

  describe('over a data_version poll', () => {
    it('tells the listeners of a topic another process published, after the next poll sees the file move', async () => {
      const { storage, otherProcessWrote } = pollingStorage();
      await storage.connect();
      const here = open(storage);
      const listener = jest.fn();
      here.subscribe('board', listener);
      await jest.advanceTimersByTimeAsync(0);

      await storage.incr('feed:board');
      otherProcessWrote();
      await jest.advanceTimersByTimeAsync(POLL_MS + COALESCE_MS);

      expect(listener).toHaveBeenCalledTimes(1);
      await storage.disconnect();
    });

    it('tells another feed on the file in this process at once, since its connection sees no data_version move', async () => {
      const { storage } = pollingStorage();
      await storage.connect();
      const first = open(storage.namespace('lens'));
      const second = open(storage.namespace('lens'));
      const elsewhere = open(storage.namespace('other'));
      const listener = jest.fn();
      const unrelated = jest.fn();
      second.subscribe('board', listener);
      elsewhere.subscribe('board', unrelated);
      await jest.advanceTimersByTimeAsync(0);

      await first.publish('board');
      await jest.advanceTimersByTimeAsync(COALESCE_MS);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(unrelated).not.toHaveBeenCalled();
      await storage.disconnect();
    });

    it("still hears another process's write after a feed on another file with the same names published", async () => {
      const mine = pollingStorage();
      const theirs = pollingStorage();
      await mine.storage.connect();
      await theirs.storage.connect();
      const here = open(mine.storage);
      const onTheirFile = open(theirs.storage);
      const listener = jest.fn();
      here.subscribe('board', listener);
      await jest.advanceTimersByTimeAsync(POLL_MS);

      await onTheirFile.publish('board');
      await jest.advanceTimersByTimeAsync(POLL_MS + COALESCE_MS);
      const afterUnrelatedPublish = listener.mock.calls.length;
      await mine.storage.incr('feed:board');
      mine.otherProcessWrote();
      await jest.advanceTimersByTimeAsync(POLL_MS + COALESCE_MS);

      expect(listener).toHaveBeenCalledTimes(afterUnrelatedPublish + 1);
      await mine.storage.disconnect();
      await theirs.storage.disconnect();
    });

    it('reads the topic counters only when the file moved', async () => {
      const { storage, otherProcessWrote } = pollingStorage();
      await storage.connect();
      const feed = open(storage);
      const mget = jest.spyOn(storage, 'mget');
      feed.subscribe('board', jest.fn());
      await jest.advanceTimersByTimeAsync(POLL_MS);
      mget.mockClear();

      await jest.advanceTimersByTimeAsync(POLL_MS * 3);
      expect(mget).not.toHaveBeenCalled();

      otherProcessWrote();
      await jest.advanceTimersByTimeAsync(POLL_MS);
      expect(mget).toHaveBeenCalledWith(['feed:board']);
      await storage.disconnect();
    });

    it('tells this process at once of its own publish, and not again when another write moves the file', async () => {
      const { storage, otherProcessWrote } = pollingStorage();
      await storage.connect();
      const feed = open(storage);
      const listener = jest.fn();
      feed.subscribe('board', listener);
      await jest.advanceTimersByTimeAsync(0);

      await feed.publish('board');
      await jest.advanceTimersByTimeAsync(COALESCE_MS);
      expect(listener).toHaveBeenCalledTimes(1);

      otherProcessWrote();
      await jest.advanceTimersByTimeAsync(POLL_MS + COALESCE_MS);
      expect(listener).toHaveBeenCalledTimes(1);
      await storage.disconnect();
    });

    it('stops polling when the last listener leaves, and when the feed closes', async () => {
      const { storage } = pollingStorage();
      await storage.connect();
      const feed = open(storage);
      const dataVersion = jest.spyOn(storage.root as Required<StorageAdapter>, 'dataVersion');
      const unsubscribe = feed.subscribe('board', jest.fn());
      await jest.advanceTimersByTimeAsync(POLL_MS);
      expect(dataVersion).toHaveBeenCalledTimes(1);

      unsubscribe();
      await jest.advanceTimersByTimeAsync(POLL_MS * 3);
      expect(dataVersion).toHaveBeenCalledTimes(1);

      feed.subscribe('board', jest.fn());
      await feed.close();
      await jest.advanceTimersByTimeAsync(POLL_MS * 3);
      expect(dataVersion).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
      await storage.disconnect();
    });

    it('reports a failing poll once until a poll succeeds again', async () => {
      const { storage } = pollingStorage();
      await storage.connect();
      const onError = jest.fn();
      const feed = open(storage, onError);
      const dataVersion = jest.spyOn(storage.root as Required<StorageAdapter>, 'dataVersion');
      dataVersion.mockRejectedValueOnce(new Error('SQLITE_BUSY')).mockRejectedValueOnce(new Error('SQLITE_BUSY'));
      feed.subscribe('board', jest.fn());

      await jest.advanceTimersByTimeAsync(POLL_MS * 3);
      expect(onError).toHaveBeenCalledTimes(1);

      dataVersion.mockRejectedValueOnce(new Error('SQLITE_BUSY'));
      await jest.advanceTimersByTimeAsync(POLL_MS);
      expect(onError).toHaveBeenCalledTimes(2);
      await storage.disconnect();
    });
  });

  it('polls every 250 ms and coalesces over 50 ms by default', async () => {
    const { storage, otherProcessWrote } = pollingStorage();
    await storage.connect();
    const feed = createChangeFeed(storage);
    feeds.push(feed);
    const listener = jest.fn();
    feed.subscribe('board', listener);
    await jest.advanceTimersByTimeAsync(0);

    await storage.incr('feed:board');
    otherProcessWrote();
    await jest.advanceTimersByTimeAsync(DEFAULT_CHANGE_FEED_POLL_INTERVAL_MS + DEFAULT_CHANGE_FEED_COALESCE_MS - 1);
    expect(listener).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect([DEFAULT_CHANGE_FEED_POLL_INTERVAL_MS, DEFAULT_CHANGE_FEED_COALESCE_MS]).toEqual([250, 50]);
    await storage.disconnect();
  });

  describe('in this process only', () => {
    it('tells the listeners of a publish, and keeps telling them when one throws', async () => {
      const onError = jest.fn();
      const feed = open(createRootStorage({ supportsPubSub: () => false } as unknown as StorageAdapter), onError);
      const failing = jest.fn(() => {
        throw new Error('listener failed');
      });
      const listener = jest.fn();
      feed.subscribe('board', failing);
      feed.subscribe('board', listener);

      await feed.publish('board');
      await jest.advanceTimersByTimeAsync(COALESCE_MS);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'listener failed' }));
    });

    it('tells nobody once a listener unsubscribed, or the feed closed', async () => {
      const feed = open(createRootStorage({ supportsPubSub: () => false } as unknown as StorageAdapter));
      const gone = jest.fn();
      const stays = jest.fn();
      const unsubscribe = feed.subscribe('board', gone);
      feed.subscribe('board', stays);

      unsubscribe();
      unsubscribe();
      await feed.publish('board');
      await feed.close();
      await jest.advanceTimersByTimeAsync(COALESCE_MS);

      expect(gone).not.toHaveBeenCalled();
      expect(stays).not.toHaveBeenCalled();
    });
  });
});
