import { AsyncProvider, ProviderScope } from '@frontmcp/sdk';
import Redis, { Redis as RedisClient } from 'ioredis';

export interface EmployeeRedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
}

export default class EmployeeRedisProvider {
  private readonly client: RedisClient;

  constructor(config: EmployeeRedisConfig = { host: 'localhost', port: 6379 }) {
    this.client = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.db ?? 0,
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });

    this.client.on('connect', () => console.log('[EmployeeRedis] Connected'));
    this.client.on('error', (err) => console.error('[EmployeeRedis] Error:', err));
  }

  // Basic helpers
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async setJSON(key: string, value: any, ttlSeconds?: number): Promise<void> {
    const str = JSON.stringify(value);
    return this.set(key, str, ttlSeconds);
  }

  async getJSON<T = any>(key: string): Promise<T | undefined> {
    const raw = await this.get(key);
    if (raw == null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }

  async incrBy(key: string, amount: number): Promise<number> {
    return this.client.incrby(key, amount);
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];
    return this.client.mget(keys);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    return this.client.sadd(key, ...members);
  }

  async smembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  async lpush(key: string, ...values: string[]): Promise<number> {
    return this.client.lpush(key, ...values);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.lrange(key, start, stop);
  }
}

export const createEmployeeRedisProvider = AsyncProvider({
  provide: EmployeeRedisProvider,
  name: 'EmployeeRedisProvider',
  scope: ProviderScope.GLOBAL,
  inject: () => [] as const,
  useFactory: async () => new EmployeeRedisProvider({ host: 'localhost', port: 6379 }),
});
