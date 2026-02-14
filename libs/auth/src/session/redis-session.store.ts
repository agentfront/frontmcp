// auth/session/redis-session.store.ts
import type { Redis } from 'ioredis';
import { randomUUID, RedisStorageAdapter } from '@frontmcp/utils';
import {
  SessionStore,
  StoredSession,
  RedisConfig,
  storedSessionSchema,
  SessionSecurityConfig,
} from './transport-session.types';
import type { AuthLogger } from '../common/auth-logger.interface';
import { signSession, verifyOrParseSession } from './session-crypto';
import { SessionRateLimiter } from './session-rate-limiter';
import { SessionIdEmptyError } from '../errors/auth-internal.errors';

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
 * Uses @frontmcp/utils RedisStorageAdapter internally.
 *
 * Security features (configurable via security option):
 * - HMAC signing: Detects session data tampering
 * - Rate limiting: Prevents session enumeration attacks
 * - Max lifetime: Prevents indefinite session extension
 */
export class RedisSessionStore implements SessionStore {
  private readonly storage: RedisStorageAdapter;
  private readonly keyPrefix: string;
  private readonly defaultTtlMs: number;
  private readonly logger?: AuthLogger;
  private externalInstance = false;

  // Security features
  private readonly security: SessionSecurityConfig;
  private readonly rateLimiter?: SessionRateLimiter;

  constructor(
    config:
      | RedisSessionStoreConfig
      | { redis: Redis; keyPrefix?: string; defaultTtlMs?: number; security?: SessionSecurityConfig },
    logger?: AuthLogger,
  ) {
    // Default TTL of 1 hour for session extension on access
    this.defaultTtlMs = ('defaultTtlMs' in config ? config.defaultTtlMs : undefined) ?? 3600000;
    this.logger = logger;
    this.keyPrefix = ('keyPrefix' in config ? config.keyPrefix : undefined) ?? 'mcp:session:';

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
      // Use provided Redis instance - wrap in adapter
      this.storage = new RedisStorageAdapter({
        client: config.redis,
        keyPrefix: this.keyPrefix,
      });
      this.externalInstance = true;
    } else {
      // Create new Redis connection from config
      const redisConfig = config as RedisConfig;
      this.storage = new RedisStorageAdapter({
        config: {
          host: redisConfig.host,
          port: redisConfig.port ?? 6379,
          password: redisConfig.password,
          db: redisConfig.db ?? 0,
          tls: redisConfig.tls,
        },
        keyPrefix: this.keyPrefix,
      });
    }
  }

  /**
   * Get the full key for a session ID (without prefix, adapter handles it)
   * @throws Error if sessionId is empty
   */
  private validateSessionId(sessionId: string): void {
    if (!sessionId || sessionId.trim() === '') {
      throw new SessionIdEmptyError('RedisSessionStore');
    }
  }

  /**
   * Ensure the storage adapter is connected
   */
  private async ensureConnected(): Promise<void> {
    // connect() is idempotent - it returns early if already connected
    await this.storage.connect();
  }

  /**
   * Get a stored session by ID
   *
   * Note: Uses atomic GETEX to extend TTL while reading, preventing race conditions
   * where concurrent readers might resurrect expired sessions.
   *
   * @param sessionId - The session ID to look up
   * @param options - Optional parameters for rate limiting
   * @param options.clientIdentifier - Client identifier (e.g., IP address) for rate limiting.
   *   When provided, rate limiting is applied per-client to prevent session enumeration.
   *   If not provided, falls back to sessionId which provides DoS protection per-session.
   */
  async get(sessionId: string, options?: { clientIdentifier?: string }): Promise<StoredSession | null> {
    this.validateSessionId(sessionId);

    // Check rate limit if enabled
    // Use clientIdentifier for enumeration protection, fallback to sessionId for DoS protection
    if (this.rateLimiter) {
      const rateLimitKey = options?.clientIdentifier || sessionId;
      const rateLimitResult = this.rateLimiter.check(rateLimitKey);
      if (!rateLimitResult.allowed) {
        this.logger?.warn('[RedisSessionStore] Rate limit exceeded for session lookup', {
          sessionId: sessionId.slice(0, 20),
          clientIdentifier: options?.clientIdentifier ? options.clientIdentifier.slice(0, 20) : undefined,
          retryAfterMs: rateLimitResult.retryAfterMs,
        });
        return null;
      }
    }

    await this.ensureConnected();

    // Try to use GETEX for atomic get+extend TTL via underlying client
    let raw: string | null;
    const redis = this.storage.getClient();
    const ttlSeconds = Math.ceil(this.defaultTtlMs / 1000);

    if (redis) {
      try {
        // GETEX with EX is atomic - no race condition possible
        // Note: Key prefix is handled by adapter, but GETEX needs full key
        raw = await (redis as Redis).getex(this.keyPrefix + sessionId, 'EX', ttlSeconds);
      } catch {
        // Fallback for older Redis versions that don't support GETEX
        raw = await this.storage.get(sessionId);
        if (raw) {
          // Extend TTL separately (non-atomic fallback)
          await this.storage.expire(sessionId, ttlSeconds);
        }
      }
    } else {
      // No direct client access, use adapter methods
      raw = await this.storage.get(sessionId);
      if (raw) {
        await this.storage.expire(sessionId, ttlSeconds);
      }
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
          const boundedTtlSeconds = Math.ceil(ttlMs / 1000);
          // Fire-and-forget with logging - we're only optimizing cache eviction timing
          this.storage.expire(sessionId, boundedTtlSeconds).catch((err) => {
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
    this.validateSessionId(sessionId);
    await this.ensureConnected();

    // Apply HMAC signing if enabled
    let value: string;
    if (this.security.enableSigning) {
      value = signSession(session, { secret: this.security.signingSecret });
    } else {
      value = JSON.stringify(session);
    }

    if (ttlMs && ttlMs > 0) {
      const ttlSeconds = Math.ceil(ttlMs / 1000);
      await this.storage.set(sessionId, value, { ttlSeconds });
    } else if (session.session.expiresAt) {
      // Use session's expiration if available
      const ttl = session.session.expiresAt - Date.now();
      if (ttl > 0) {
        const ttlSeconds = Math.ceil(ttl / 1000);
        await this.storage.set(sessionId, value, { ttlSeconds });
      } else {
        // Already expired, but store anyway (will be cleaned up on next access)
        await this.storage.set(sessionId, value);
      }
    } else {
      // No TTL - session persists until explicitly deleted
      await this.storage.set(sessionId, value);
    }
  }

  /**
   * Delete a session
   */
  async delete(sessionId: string): Promise<void> {
    this.validateSessionId(sessionId);
    await this.ensureConnected();
    await this.storage.delete(sessionId);
  }

  /**
   * Check if a session exists
   */
  async exists(sessionId: string): Promise<boolean> {
    this.validateSessionId(sessionId);
    await this.ensureConnected();
    return this.storage.exists(sessionId);
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
      await this.storage.disconnect();
    }
  }

  /**
   * Get the underlying Redis client (for advanced use cases)
   */
  getRedisClient(): Redis | undefined {
    return this.storage.getClient() as Redis | undefined;
  }

  /**
   * Test Redis connection by sending a PING command.
   * Useful for validating connection on startup.
   *
   * @returns true if connection is healthy, false otherwise
   */
  async ping(): Promise<boolean> {
    try {
      await this.ensureConnected();
      return this.storage.ping();
    } catch (error) {
      this.logger?.error('[RedisSessionStore] Connection failed', {
        error: (error as Error).message,
      });
      return false;
    }
  }
}
