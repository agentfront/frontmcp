// auth/session/redis-session.store.ts
import IoRedis, { Redis, RedisOptions } from 'ioredis';
import { randomUUID } from 'crypto';
import { SessionStore, StoredSession, RedisConfig, storedSessionSchema } from './transport-session.types';
import { FrontMcpLogger } from '../../common/interfaces/logger.interface';

/**
 * Redis-backed session store implementation
 *
 * Provides persistent session storage for distributed deployments.
 * Sessions are stored as JSON with optional TTL.
 */
export class RedisSessionStore implements SessionStore {
  private readonly redis: Redis;
  private readonly keyPrefix: string;
  private readonly defaultTtlMs: number;
  private readonly logger?: FrontMcpLogger;
  private externalInstance = false;

  constructor(
    config: RedisConfig | { redis: Redis; keyPrefix?: string; defaultTtlMs?: number },
    logger?: FrontMcpLogger,
  ) {
    // Default TTL of 1 hour for session extension on access
    this.defaultTtlMs = ('defaultTtlMs' in config ? config.defaultTtlMs : undefined) ?? 3600000;
    this.logger = logger;

    if ('redis' in config && config.redis) {
      // Use provided Redis instance
      this.redis = config.redis;
      this.keyPrefix = config.keyPrefix ?? 'mcp:session:';
      this.externalInstance = true;
    } else {
      // Create new Redis connection from config
      const redisConfig = config as RedisConfig;
      const options: RedisOptions = {
        host: redisConfig.host,
        port: redisConfig.port ?? 6379,
        password: redisConfig.password,
        db: redisConfig.db ?? 0,
      };

      if (redisConfig.tls) {
        options.tls = {};
      }

      this.redis = new IoRedis(options);
      this.keyPrefix = redisConfig.keyPrefix ?? 'mcp:session:';
    }
  }

  /**
   * Get the full Redis key for a session ID
   * @throws Error if sessionId is empty
   */
  private key(sessionId: string): string {
    if (!sessionId || sessionId.trim() === '') {
      throw new Error('[RedisSessionStore] sessionId cannot be empty');
    }
    return `${this.keyPrefix}${sessionId}`;
  }

  /**
   * Get a stored session by ID
   *
   * Note: Uses atomic GETEX to extend TTL while reading, preventing race conditions
   * where concurrent readers might resurrect expired sessions.
   */
  async get(sessionId: string): Promise<StoredSession | null> {
    const key = this.key(sessionId);

    // Use GETEX to atomically get and extend TTL in a single operation
    // This prevents the race where one request deletes expired session
    // while another is trying to extend it
    let raw: string | null;
    try {
      // GETEX with EXAT/PXAT is atomic - no race condition possible
      raw = await this.redis.getex(key, 'PX', this.defaultTtlMs);
    } catch {
      // Fallback for older Redis versions that don't support GETEX
      raw = await this.redis.get(key);
    }

    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      const result = storedSessionSchema.safeParse(parsed);

      if (!result.success) {
        this.logger?.warn('[RedisSessionStore] Invalid session format', { sessionId: sessionId.slice(0, 20) });
        // Delete invalid session data
        this.delete(sessionId).catch(() => void 0);
        return null;
      }

      const session = result.data;

      // Check application-level expiration (separate from Redis TTL)
      if (session.session.expiresAt && session.session.expiresAt < Date.now()) {
        // Session is logically expired - delete it
        // Note: We await the delete to ensure it completes before returning
        // This prevents race conditions where another read might get the expired session
        await this.delete(sessionId);
        return null;
      }

      // Update last accessed timestamp (in the returned object)
      // Note: We don't fire-and-forget a set() here because:
      // 1. GETEX already extended the Redis TTL
      // 2. Fire-and-forget can cause race conditions with deletion
      const updatedSession: StoredSession = {
        ...session,
        lastAccessedAt: Date.now(),
      };

      return updatedSession;
    } catch (error) {
      this.logger?.warn('[RedisSessionStore] Failed to parse session', {
        sessionId: sessionId.slice(0, 20),
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Store a session with optional TTL
   */
  async set(sessionId: string, session: StoredSession, ttlMs?: number): Promise<void> {
    const key = this.key(sessionId);
    const value = JSON.stringify(session);

    if (ttlMs && ttlMs > 0) {
      // Use PX for millisecond precision
      await this.redis.set(key, value, 'PX', ttlMs);
    } else if (session.session.expiresAt) {
      // Use session's expiration if available
      const ttl = session.session.expiresAt - Date.now();
      if (ttl > 0) {
        await this.redis.set(key, value, 'PX', ttl);
      } else {
        // Already expired, but store anyway (will be cleaned up on next access)
        await this.redis.set(key, value);
      }
    } else {
      // No TTL - session persists until explicitly deleted
      await this.redis.set(key, value);
    }
  }

  /**
   * Delete a session
   */
  async delete(sessionId: string): Promise<void> {
    await this.redis.del(this.key(sessionId));
  }

  /**
   * Check if a session exists
   */
  async exists(sessionId: string): Promise<boolean> {
    return (await this.redis.exists(this.key(sessionId))) === 1;
  }

  /**
   * Allocate a new session ID
   */
  allocId(): string {
    return randomUUID();
  }

  /**
   * Disconnect from Redis (only if we created the connection)
   */
  async disconnect(): Promise<void> {
    if (!this.externalInstance) {
      await this.redis.quit();
    }
  }

  /**
   * Get the underlying Redis client (for advanced use cases)
   */
  getRedisClient(): Redis {
    return this.redis;
  }

  /**
   * Test Redis connection by sending a PING command.
   * Useful for validating connection on startup.
   *
   * @returns true if connection is healthy, false otherwise
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }
}
