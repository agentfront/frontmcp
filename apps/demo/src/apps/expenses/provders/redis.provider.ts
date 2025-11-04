import { AsyncProvider, ProviderScope } from '@frontmcp/sdk';
import ExpenseConfigProvider from './config.provider';
import Redis, { Redis as RedisClient } from 'ioredis';

interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
}

export default class RedisProvider {
  private readonly client: RedisClient;

  constructor(config: RedisConfig) {
    this.client = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.db ?? 0,
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });

    this.client.on('connect', () => console.log('[Redis] Connected'));
    this.client.on('error', (err) => console.error('[Redis] Error:', err));
  }

  /** Set any value (auto-stringifies objects) */
  async setValue(key: string, value: any, ttlSeconds?: number): Promise<void> {
    const strValue = typeof value === 'string' ? value : JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, strValue, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, strValue);
    }
  }

  /** Get a value and automatically parse JSON if possible */
  async getValue<T = any>(key: string, defaultValue?: T): Promise<T | undefined> {
    const raw = await this.client.get(key);
    if (raw === null) return defaultValue;

    try {
      return JSON.parse(raw) as T;
    } catch {
      // fallback for plain string values
      return raw as unknown as T;
    }
  }

  /** Delete a key */
  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  /** Check if a key exists */
  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }

  /** Gracefully close the Redis connection */
  async close(): Promise<void> {
    await this.client.quit();
  }
}

/** MCP async provider factory */
export const createRedisProvider = AsyncProvider({
  provide: RedisProvider,
  name: 'RedisProvider',
  scope: ProviderScope.GLOBAL,
  inject: () => [ExpenseConfigProvider] as const,
  useFactory: async (config) => {
    const redisConfig = config.get<RedisConfig>('redis');
    return new RedisProvider(redisConfig);
  },
});
