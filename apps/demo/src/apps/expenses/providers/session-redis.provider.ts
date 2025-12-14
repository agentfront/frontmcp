import RedisProvider from './redis.provider';
import { FrontMcpProvider, ProviderScope, SessionKey } from '@frontmcp/sdk';

@FrontMcpProvider({
  name: 'redis-session',
  description: 'Session-scoped Redis provider that prefixes keys by session id',
  scope: ProviderScope.SESSION,
})
export default class SessionRedisProvider {
  private readonly prefix: string;

  constructor(private readonly redis: RedisProvider, private readonly sessionKey: SessionKey) {
    const safeSid = sessionKey.value.trim().replace(/\s+/g, '_').replace(/:+/g, '_');
    this.prefix = `:session:${safeSid}:`;
  }

  private k(key: string): string {
    return `${this.prefix}${key}`;
  }

  /** Set any value (auto-JSON). Optional TTL in seconds. */
  async setValue<T = any>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.redis.setValue(this.k(key), value, ttlSeconds);
  }

  /** Get value (auto-parse JSON). Returns defaultValue if key missing. */
  async getValue<T = any>(key: string, defaultValue?: T): Promise<T | undefined> {
    return this.redis.getValue<T>(this.k(key), defaultValue);
  }

  /** Check if a session key exists. */
  async exists(key: string): Promise<boolean> {
    return this.redis.exists(this.k(key));
  }

  /** Delete a specific session key. */
  async delete(key: string): Promise<void> {
    await this.redis.delete(this.k(key));
  }

  /** Optional: clear all keys for this session (SCAN + DEL in batches). */
  async clearAllKeys(batchSize = 200): Promise<void> {
    const client: any = (this.redis as any).client ?? (this.redis as any)['client'];
    if (!client || typeof client.scan !== 'function') return;

    const pattern = `${this.prefix}*`;
    let cursor = '0';
    const toDelete: string[] = [];

    do {
      const [next, keys]: [string, string[]] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', batchSize);
      cursor = next;
      toDelete.push(...keys);
      while (toDelete.length >= batchSize) {
        const chunk = toDelete.splice(0, batchSize);
        if (chunk.length) await client.del(...chunk);
      }
    } while (cursor !== '0');

    if (toDelete.length) await client.del(...toDelete);
  }
}
