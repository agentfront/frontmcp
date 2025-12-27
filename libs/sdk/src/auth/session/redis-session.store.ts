// auth/session/redis-session.store.ts
import IoRedis, { Redis, RedisOptions } from 'ioredis';
import { randomUUID } from 'crypto';
import {
  SessionStore,
  StoredSession,
  RedisConfig,
  storedSessionSchema,
  SessionSecurityConfig,
} from './transport-session.types';
import { FrontMcpLogger } from '../../common/interfaces/logger.interface';
import { signSession, verifyOrParseSession } from './session-crypto';
import { SessionRateLimiter } from './session-rate-limiter';

/**
 * Extended Redis configuration with security options.
 */
export interface RedisSessionStoreConfig extends RedisConfig {
  /** Security hardening options */
  security?: SessionSecurityConfig;
}

/**
 * Redis-backed session store implementation
 *
 * Provides persistent session storage for distributed deployments.
 * Sessions are stored as JSON with optional TTL.
 *
 * Security features (configurable via security option):
 * - HMAC signing: Detects session data tampering
 * - Rate limiting: Prevents session enumeration attacks
 * - Max lifetime: Prevents indefinite session extension
 */
export class RedisSessionStore implements SessionStore {
  private readonly redis: Redis;
  private readonly keyPrefix: string;
  private readonly defaultTtlMs: number;
  private readonly logger?: FrontMcpLogger;
  private externalInstance = false;

  // Security features
  private readonly security: SessionSecurityConfig;
  private readonly rateLimiter?: SessionRateLimiter;

  constructor(
    config:
      | RedisSessionStoreConfig
      | { redis: Redis; keyPrefix?: string; defaultTtlMs?: number; security?: SessionSecurityConfig },
    logger?: FrontMcpLogger,
  ) {
    // Default TTL of 1 hour for session extension on access
    this.defaultTtlMs = ('defaultTtlMs' in config ? config.defaultTtlMs : undefined) ?? 3600000;
    this.logger = logger;

    // Initialize security configuration
    this.security = ('security' in config ? config.security : undefined) ?? {};

    // Initialize rate limiter if enabled
    if (this.security.enableRateLimiting) {
      this.rateLimiter = new SessionRateLimiter({
        windowMs: this.security.rateLimiting?.windowMs,
        maxRequests: this.security.rateLimiting?.maxRequests,
      });
    }

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
    // Check rate limit if enabled
    if (this.rateLimiter) {
      const rateLimitResult = this.rateLimiter.check(sessionId);
      if (!rateLimitResult.allowed) {
        this.logger?.warn('[RedisSessionStore] Rate limit exceeded for session lookup', {
          sessionId: sessionId.slice(0, 20),
          retryAfterMs: rateLimitResult.retryAfterMs,
        });
        return null;
      }
    }

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
      // If signing is enabled, verify and extract the session
      // Otherwise, just parse it (supports both signed and unsigned sessions)
      let parsed: StoredSession | null;
      if (this.security.enableSigning) {
        parsed = verifyOrParseSession(raw, { secret: this.security.signingSecret });
        if (!parsed) {
          this.logger?.warn('[RedisSessionStore] Session signature verification failed', {
            sessionId: sessionId.slice(0, 20),
          });
          this.delete(sessionId).catch(() => void 0);
          return null;
        }
      } else {
        parsed = JSON.parse(raw);
      }

      const result = storedSessionSchema.safeParse(parsed);

      if (!result.success) {
        this.logger?.warn('[RedisSessionStore] Invalid session format', {
          sessionId: sessionId.slice(0, 20),
          errors: result.error.issues.slice(0, 3).map((i) => ({ path: i.path, message: i.message })),
        });
        // Delete invalid session data
        this.delete(sessionId).catch(() => void 0);
        return null;
      }

      const session = result.data;

      // Check absolute maximum lifetime (prevents indefinite session extension)
      if (session.maxLifetimeAt && session.maxLifetimeAt < Date.now()) {
        this.logger?.info('[RedisSessionStore] Session exceeded max lifetime', {
          sessionId: sessionId.slice(0, 20),
          maxLifetimeAt: session.maxLifetimeAt,
        });
        await this.delete(sessionId);
        return null;
      }

      // Check application-level expiration (separate from Redis TTL)
      if (session.session.expiresAt && session.session.expiresAt < Date.now()) {
        // Session is logically expired - delete it
        // Note: We await the delete to ensure it completes before returning
        // This prevents race conditions where another read might get the expired session
        await this.delete(sessionId);
        return null;
      }

      // Bound Redis TTL by session.expiresAt to avoid keeping expired sessions in Redis
      // GETEX may have extended TTL beyond expiresAt, so we shorten it if needed
      if (session.session.expiresAt) {
        const ttlMs = Math.min(this.defaultTtlMs, session.session.expiresAt - Date.now());
        if (ttlMs > 0 && ttlMs < this.defaultTtlMs) {
          // Fire-and-forget with logging - we're only optimizing cache eviction timing
          this.redis.pexpire(key, ttlMs).catch((err) => {
            this.logger?.warn('[RedisSessionStore] TTL extension failed', {
              sessionId: sessionId.slice(0, 20),
              error: (err as Error).message,
            });
          });
        }
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
      // Delete corrupted session payloads to prevent repeated failures
      this.delete(sessionId).catch(() => void 0);
      return null;
    }
  }

  /**
   * Store a session with optional TTL
   */
  async set(sessionId: string, session: StoredSession, ttlMs?: number): Promise<void> {
    const key = this.key(sessionId);

    // Apply HMAC signing if enabled
    let value: string;
    if (this.security.enableSigning) {
      value = signSession(session, { secret: this.security.signingSecret });
    } else {
      value = JSON.stringify(session);
    }

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
