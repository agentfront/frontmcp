
import type { SetOptions, StoreDriver } from '../store.types';

export abstract class StoreBaseAdapter implements StoreDriver {
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;

  abstract get(key: string): Promise<string | null>;
  abstract set(key: string, value: string, opts?: SetOptions): Promise<void>;
  abstract del(key: string): Promise<void>;
  abstract exists(key: string): Promise<boolean>;

  abstract incr(key: string): Promise<number>;
  abstract decr(key: string): Promise<number>;

  abstract expire(key: string, ttlSeconds: number): Promise<void>;
  abstract ttl(key: string): Promise<number | null>;

  async mget(keys: string[]): Promise<(string | null)[]> { return Promise.all(keys.map((k) => this.get(k))); }
  async mset(entries: Array<{ key: string; value: string; opts?: SetOptions }>): Promise<void> {
    for (const e of entries) await this.set(e.key, e.value, e.opts);
  }

  async publish(_channel: string, _message: string): Promise<number> { return 0; }
  async subscribe(_channel: string, _handler: (message: string) => void): Promise<() => Promise<void>> {
    return async () => undefined;
  }
}
