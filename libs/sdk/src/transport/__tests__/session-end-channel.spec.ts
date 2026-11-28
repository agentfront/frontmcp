/**
 * #1446: a DELETE outside distributed mode asks the other instances sharing the session store to close
 * the session, and answers once each one did, or with a retryable 503 after a bounded wait.
 */
import { SessionEndUnconfirmedError } from '../../errors/transport.errors';
import {
  isSessionEndPubSub,
  SESSION_END_CHANNEL,
  SessionEndChannel,
  type SessionEndPubSub,
} from '../session-end-channel';

/** One Redis channel the instances share: a message reaches every listener, its sender included. */
class FakeRedis {
  readonly listeners = new Set<(message: string) => void>();
  published: Array<Record<string, unknown>> = [];

  pubsub(): SessionEndPubSub {
    return {
      publish: async (channel, message) => {
        expect(channel).toBe(SESSION_END_CHANNEL);
        this.published.push(JSON.parse(message));
        for (const listener of [...this.listeners]) listener(message);
        const count = this.listeners.size;
        // Answers may arrive while PUBLISH and NUMSUB are still counting the listeners
        await new Promise((resolve) => setImmediate(resolve));
        return count;
      },
      subscribe: async (_channel, onMessage) => {
        this.listeners.add(onMessage);
        return async () => {
          this.listeners.delete(onMessage);
        };
      },
    };
  }
}

function logger() {
  return { info: jest.fn(), warn: jest.fn() };
}

async function instance(redis: FakeRedis, endLocal: jest.Mock = jest.fn().mockResolvedValue(false)) {
  const log = logger();
  const channel = new SessionEndChannel({ pubsub: redis.pubsub(), endLocal, logger: log });
  await channel.start();
  return { channel, endLocal, log };
}

describe('SessionEndChannel', () => {
  afterEach(() => jest.useRealTimers());

  it('asks every other instance to close the session and resolves once each one answered', async () => {
    const redis = new FakeRedis();
    const asking = await instance(redis);
    let close: (held: boolean) => void = () => undefined;
    const holder = await instance(
      redis,
      jest.fn(() => new Promise<boolean>((resolve) => (close = resolve))),
    );
    const bystander = await instance(redis);

    let resolved = false;
    const ended = asking.channel.endElsewhere('sess-1').then(() => (resolved = true));
    await new Promise((resolve) => setImmediate(resolve));
    expect(holder.endLocal).toHaveBeenCalledWith('sess-1');
    expect(bystander.endLocal).toHaveBeenCalledWith('sess-1');
    expect(asking.endLocal).not.toHaveBeenCalled();
    expect(resolved).toBe(false);

    close(true);
    await ended;
    expect(redis.published).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'session-ended', instanceId: holder.channel.instanceId, held: true }),
        expect.objectContaining({ kind: 'session-ended', instanceId: bystander.channel.instanceId, held: false }),
      ]),
    );
    expect(holder.log.info).toHaveBeenCalledWith(expect.stringContaining('Closed a session'), { sessionId: 'sess-1' });
  });

  it('resolves at once when no other instance listens', async () => {
    const redis = new FakeRedis();
    const { channel } = await instance(redis);

    await expect(channel.endElsewhere('sess-1')).resolves.toBeUndefined();
  });

  it('answers a retryable 503 when an instance does not confirm within the bounded wait', async () => {
    jest.useFakeTimers();
    const redis = new FakeRedis();
    const asking = await instance(redis);
    await instance(
      redis,
      jest.fn(() => new Promise<boolean>(() => undefined)),
    );
    await instance(redis);

    let settled = false;
    const ended = asking.channel.endElsewhere('sess-1').catch((error: unknown) => {
      settled = true;
      return error;
    });
    await jest.advanceTimersByTimeAsync(4_900);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(100);
    const error = (await ended) as SessionEndUnconfirmedError;

    expect(error).toBeInstanceOf(SessionEndUnconfirmedError);
    expect(error.statusCode).toBe(503);
    expect(error.retryAfterSeconds).toBe(5);
    expect(error.kind).toBe('timed-out');
    expect(error.holder).toBe('1 of 2 other instances');
    expect(asking.log.warn).toHaveBeenCalledWith(expect.stringContaining('did not confirm in time'), {
      sessionId: 'sess-1',
      unanswered: 1,
      listening: 2,
    });
  });

  it('takes no answer from an instance that could not close the session', async () => {
    jest.useFakeTimers();
    const redis = new FakeRedis();
    const asking = await instance(redis);
    const failing = await instance(redis, jest.fn().mockRejectedValue(new Error('close failed')));

    const ended = asking.channel.endElsewhere('sess-1').catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(5_000);

    expect(await ended).toBeInstanceOf(SessionEndUnconfirmedError);
    expect(failing.log.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to close'), {
      sessionId: 'sess-1',
      error: 'close failed',
    });
  });

  it('does not ask while it does not listen: it could not hear the answers', async () => {
    const redis = new FakeRedis();
    const pubsub = redis.pubsub();
    const publish = jest.spyOn(pubsub, 'publish');
    const notStarted = new SessionEndChannel({ pubsub, endLocal: jest.fn(), logger: logger() });

    await notStarted.endElsewhere('sess-1');
    await notStarted.start();
    await notStarted.close();
    await notStarted.close();
    await notStarted.endElsewhere('sess-1');

    expect(publish).not.toHaveBeenCalled();
    expect(redis.listeners.size).toBe(0);
    expect(notStarted.listening).toBe(false);
  });

  it('stops listening when closed while its subscription was still being made', async () => {
    const redis = new FakeRedis();
    const channel = new SessionEndChannel({ pubsub: redis.pubsub(), endLocal: jest.fn(), logger: logger() });

    const started = channel.start();
    await channel.close();
    await started;

    expect(redis.listeners.size).toBe(0);
    expect(channel.listening).toBe(false);
  });

  it('ignores its own messages, malformed ones, and answers to no request of its own', async () => {
    const redis = new FakeRedis();
    const { channel, endLocal } = await instance(redis);
    const deliver = (message: string) => [...redis.listeners].forEach((listener) => listener(message));

    deliver('not json');
    deliver('null');
    deliver(JSON.stringify({ kind: 'end-session', sessionId: 's' }));
    deliver(JSON.stringify({ kind: 'end-session', requestId: 'r', sessionId: 's', instanceId: channel.instanceId }));
    deliver(
      JSON.stringify({ kind: 'session-ended', requestId: 'unknown', sessionId: 's', instanceId: 'x', held: true }),
    );
    deliver(JSON.stringify({ kind: 'other', requestId: 'r', sessionId: 's', instanceId: 'x' }));
    await new Promise((resolve) => setImmediate(resolve));

    expect(endLocal).not.toHaveBeenCalled();
    expect(redis.published).toEqual([]);
  });

  it('logs an answer it could not publish', async () => {
    const redis = new FakeRedis();
    const log = logger();
    const pubsub = redis.pubsub();
    const channel = new SessionEndChannel({
      pubsub: { ...pubsub, publish: jest.fn().mockRejectedValue(new Error('Redis down')) },
      endLocal: jest.fn().mockResolvedValue(true),
      logger: log,
    });
    await channel.start();

    [...redis.listeners].forEach((listener) =>
      listener(JSON.stringify({ kind: 'end-session', requestId: 'r', sessionId: 'sess-1', instanceId: 'other' })),
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to confirm'), {
      sessionId: 'sess-1',
      error: 'Redis down',
    });
  });

  it('runs on a session store with pub/sub only', () => {
    expect(isSessionEndPubSub(new FakeRedis().pubsub())).toBe(true);
    expect(isSessionEndPubSub({ get: jest.fn() })).toBe(false);
    expect(isSessionEndPubSub(undefined)).toBe(false);
  });
});
