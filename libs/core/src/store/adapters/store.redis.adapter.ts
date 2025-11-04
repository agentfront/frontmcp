import { StoreBaseAdapter } from './store.base.adapter';
import type { SetOptions } from '../store.types';
import IoRedis, { Redis, RedisOptions } from 'ioredis';

export interface RedisAdapterOptions {
  redis?: Redis;
  connectionUri?: string;
  options?: RedisOptions;
}

export class ScopedRedisStore extends StoreBaseAdapter {
  private redis!: Redis;
  private sub?: Redis;
  private externalInstance = false;

  constructor(private readonly opts: RedisAdapterOptions = {}) {
    super();
  }

  async connect(): Promise<void> {
    if (this.redis) return;
    if (this.opts.redis) {
      this.redis = this.opts.redis;
      this.externalInstance = true;
    } else if (this.opts.options) {
      this.redis = new IoRedis(this.opts.options);
    }
    this.sub = new IoRedis(this.redis.options);
  }

  async disconnect(): Promise<void> {
    if (!this.externalInstance && this.redis) await this.redis.quit();
    if (this.sub) await this.sub.quit();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.redis = undefined as any;
    this.sub = undefined;
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }
  async set(key: string, value: string, opts?: SetOptions): Promise<void> {
    if (opts?.ttlSeconds && opts.ttlSeconds > 0) await this.redis.set(key, value, 'EX', Math.floor(opts.ttlSeconds));
    else await this.redis.set(key, value);
  }
  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }
  async exists(key: string): Promise<boolean> {
    return (await this.redis.exists(key)) === 1;
  }
  override async mget(keys: string[]): Promise<(string | null)[]> {
    if (!keys.length) return [];
    const res = await this.redis.mget(keys);
    return res as (string | null)[];
  }
  override async mset(entries: Array<{ key: string; value: string; opts?: SetOptions }>): Promise<void> {
    if (!entries.length) return;
    const pipe = this.redis.pipeline();
    for (const { key, value, opts } of entries) {
      if (opts?.ttlSeconds && opts.ttlSeconds > 0) pipe.set(key, value, 'EX', Math.floor(opts.ttlSeconds));
      else pipe.set(key, value);
    }
    await pipe.exec();
  }
  async incr(key: string): Promise<number> {
    return this.redis.incr(key);
  }
  async decr(key: string): Promise<number> {
    return this.redis.decr(key);
  }
  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.redis.expire(key, Math.floor(ttlSeconds));
  }
  async ttl(key: string): Promise<number | null> {
    const t = await this.redis.ttl(key);
    return t < 0 ? null : t;
  }
  override async publish(channel: string, message: string): Promise<number> {
    return this.redis.publish(channel, message);
  }
  override async subscribe(channel: string, handler: (message: string) => void): Promise<() => Promise<void>> {
    if (!this.sub) throw new Error('Redis subscriber not initialized');
    await this.sub.subscribe(channel);
    const listener = (_ch: string, msg: string) => {
      if (_ch === channel) handler(msg);
    };
    this.sub.on('message', listener);
    return async () => {
      if (this.sub) {
        this.sub.removeListener('message', listener);
        await this.sub.unsubscribe(channel);
      }
    };
  }
}
