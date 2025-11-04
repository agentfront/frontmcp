import { EventEmitter } from 'events';
import { StoreBaseAdapter } from './store.base.adapter';
import type { SetOptions } from '../store.types';

interface Entry {
  value: string;
  expiresAt?: number;
}

export class ScopedInMemoryStore extends StoreBaseAdapter {
  private map = new Map<string, Entry>();
  private bus = new EventEmitter();

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {
    this.map.clear();
    this.bus.removeAllListeners();
  }

  private isExpired(e?: Entry): boolean {
    return !!e?.expiresAt && e.expiresAt <= Date.now();
  }
  private getEntry(key: string): Entry | undefined {
    const e = this.map.get(key);
    if (this.isExpired(e)) {
      this.map.delete(key);
      return undefined;
    }
    return e;
  }

  async get(key: string): Promise<string | null> {
    const e = this.getEntry(key);
    return e ? e.value : null;
  }
  async set(key: string, value: string, opts?: SetOptions): Promise<void> {
    const entry: Entry = { value };
    if (opts?.ttlSeconds && opts.ttlSeconds > 0) entry.expiresAt = Date.now() + Math.floor(opts.ttlSeconds) * 1000;
    this.map.set(key, entry);
  }
  async del(key: string): Promise<void> {
    this.map.delete(key);
  }
  async exists(key: string): Promise<boolean> {
    return this.getEntry(key) !== undefined;
  }
  override async mget(keys: string[]): Promise<(string | null)[]> {
    return Promise.all(keys.map((k) => this.get(k)));
  }
  override async mset(entries: Array<{ key: string; value: string; opts?: SetOptions }>): Promise<void> {
    for (const e of entries) await this.set(e.key, e.value, e.opts);
  }
  async incr(key: string): Promise<number> {
    const v = Number(await this.get(key)) || 0;
    const nv = v + 1;
    await this.set(key, String(nv));
    return nv;
  }
  async decr(key: string): Promise<number> {
    const v = Number(await this.get(key)) || 0;
    const nv = v - 1;
    await this.set(key, String(nv));
    return nv;
  }
  async expire(key: string, ttlSeconds: number): Promise<void> {
    const e = this.getEntry(key);
    if (!e) return;
    e.expiresAt = Date.now() + Math.floor(ttlSeconds) * 1000;
    this.map.set(key, e);
  }
  async ttl(key: string): Promise<number | null> {
    const e = this.getEntry(key);
    if (!e || !e.expiresAt) return null;
    const ms = e.expiresAt - Date.now();
    return ms > 0 ? Math.ceil(ms / 1000) : null;
  }
  override async publish(channel: string, message: string): Promise<number> {
    const c = this.bus.listenerCount(channel);
    setTimeout(() => this.bus.emit(channel, message), 0);
    return c;
  }
  override async subscribe(channel: string, handler: (message: string) => void): Promise<() => Promise<void>> {
    this.bus.on(channel, handler);
    return async () => {
      this.bus.off(channel, handler);
    };
  }
}
