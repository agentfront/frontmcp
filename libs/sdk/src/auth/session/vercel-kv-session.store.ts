/**
 * Vercel KV Session Store
 *
 * Session store implementation using Vercel KV (edge-compatible REST-based key-value store).
 * Uses dynamic import to avoid bundling @vercel/kv for non-Vercel deployments.
 *
 * @warning **Atomicity Limitation**: Vercel KV does not support atomic GET+EXPIRE (GETEX).
 * The `get()` method uses separate GET and PEXPIRE calls, creating a small race window
 * where the session could expire between these two operations. For mission-critical
 * session handling requiring strict atomicity guarantees, consider using Redis directly
 * via `RedisSessionStore`.
 *
 * @see https://vercel.com/docs/storage/vercel-kv
 */

import { randomUUID } from '@frontmcp/utils';
import { SessionStore, StoredSession, storedSessionSchema, SessionSecurityConfig } from './transport-session.types';
import { FrontMcpLogger } from '../../common/interfaces/logger.interface';
import type { VercelKvProviderOptions } from '../../common/types/options/redis.options';
import { signSession, verifyOrParseSession } from './session-crypto';
import { SessionRateLimiter } from './session-rate-limiter';

// Interface for the Vercel KV client (matches @vercel/kv API)
// Using custom interface to avoid type compatibility issues with optional dependency
interface VercelKVClient {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, options?: { ex?: number; px?: number }): Promise<void>;
  del(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<number>;
}

export interface VercelKvSessionConfig {
  /**
   * KV REST API URL
   * @default process.env.KV_REST_API_URL
   */
  url?: string;

  /**
   * KV REST API Token
   * @default process.env.KV_REST_API_TOKEN
   */
  token?: string;

  /**
   * Key prefix for session keys
   * @default 'mcp:session:'
   */
  keyPrefix?: string;

  /**
   * Default TTL in milliseconds for session extension on access
   * @default 3600000 (1 hour)
   */
  defaultTtlMs?: number;

  /**
   * Security hardening options
   */
  security?: SessionSecurityConfig;
}

/**
 * Vercel KV-backed session store implementation
 *
 * Provides persistent session storage for edge deployments using Vercel KV.
 * Sessions are stored as JSON with optional TTL.
 */
export class VercelKvSessionStore implements SessionStore {
  private kv: VercelKVClient | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly keyPrefix: string;
  private readonly defaultTtlMs: number;
  private readonly logger?: FrontMcpLogger;
  private readonly config: VercelKvSessionConfig;

  // Security features
  private readonly security: SessionSecurityConfig;
  private readonly rateLimiter?: SessionRateLimiter;

  constructor(config: VercelKvSessionConfig | VercelKvProviderOptions, logger?: FrontMcpLogger) {
    this.config = config;
    this.keyPrefix = config.keyPrefix ?? 'mcp:session:';
    this.defaultTtlMs = config.defaultTtlMs ?? 3600000;
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
  }

  /**
   * Connect to Vercel KV
   * Uses dynamic import to avoid bundling @vercel/kv when not used.
   * Thread-safe: concurrent calls will share the same connection promise.
   */
  async connect(): Promise<void> {
    if (this.kv) return;

    // Prevent concurrent connection attempts
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.doConnect();
    try {
      await this.connectPromise;
    } catch (error) {
      // Reset promise on failure to allow retry
      this.connectPromise = null;
      throw error;
    }
  }

  private async doConnect(): Promise<void> {
    const { createClient } = await import('@vercel/kv');

    const url = this.config.url || process.env['KV_REST_API_URL'];
    const token = this.config.token || process.env['KV_REST_API_TOKEN'];

    if (!url || !token) {
      throw new Error(
        'Vercel KV requires url and token. Set KV_REST_API_URL and KV_REST_API_TOKEN environment variables or provide them in config.',
      );
    }

    // Cast to our interface to avoid type compatibility issues
    this.kv = createClient({ url, token }) as unknown as VercelKVClient;
  }

  private async ensureConnected(): Promise<VercelKVClient> {
    await this.connect();
    if (!this.kv) {
      throw new Error('[VercelKvSessionStore] Connection failed - client not initialized');
    }
    return this.kv;
  }

  /**
   * Get the full key for a session ID
   * @throws Error if sessionId is empty
   */
  private key(sessionId: string): string {
    if (!sessionId || sessionId.trim() === '') {
      throw new Error('[VercelKvSessionStore] sessionId cannot be empty');
    }
    return `${this.keyPrefix}${sessionId}`;
  }

  /**
   * Get a stored session by ID
   *
   * Note: Vercel KV doesn't support GETEX, so we use GET + PEXPIRE separately.
   * This is slightly less atomic than Redis GETEX but sufficient for most use cases.
   *
   * @param sessionId - The session ID to look up
   * @param options - Optional parameters for rate limiting
   * @param options.clientIdentifier - Client identifier (e.g., IP address) for rate limiting.
   *   When provided, rate limiting is applied per-client to prevent session enumeration.
   *   If not provided, falls back to sessionId which provides DoS protection per-session.
   */
  async get(sessionId: string, options?: { clientIdentifier?: string }): Promise<StoredSession | null> {
    // Check rate limit if enabled
    // Use clientIdentifier for enumeration protection, fallback to sessionId for DoS protection
    if (this.rateLimiter) {
      const rateLimitKey = options?.clientIdentifier || sessionId;
      const rateLimitResult = this.rateLimiter.check(rateLimitKey);
      if (!rateLimitResult.allowed) {
        this.logger?.warn('[VercelKvSessionStore] Rate limit exceeded for session lookup', {
          sessionId: sessionId.slice(0, 20),
          clientIdentifier: options?.clientIdentifier ? options.clientIdentifier.slice(0, 20) : undefined,
          retryAfterMs: rateLimitResult.retryAfterMs,
        });
        return null;
      }
    }

    const kv = await this.ensureConnected();
    const key = this.key(sessionId);

    // Get the session
    const raw = await kv.get<string>(key);
    if (!raw) return null;

    // Extend TTL (fire-and-forget with logging, similar to Redis GETEX behavior)
    // Note: This is non-atomic - see class-level @warning for details
    kv.pexpire(key, this.defaultTtlMs).catch((err) => {
      this.logger?.warn('[VercelKvSessionStore] TTL extension failed', {
        sessionId: sessionId.slice(0, 20),
        error: (err as Error).message,
      });
    });

    try {
      // If signing is enabled, verify and extract the session
      // Otherwise, just parse it (supports both signed and unsigned sessions)
      let parsed: StoredSession | null;
      const rawStr = typeof raw === 'string' ? raw : JSON.stringify(raw);

      if (this.security.enableSigning) {
        parsed = verifyOrParseSession(rawStr, { secret: this.security.signingSecret });
        if (!parsed) {
          this.logger?.warn('[VercelKvSessionStore] Session signature verification failed', {
            sessionId: sessionId.slice(0, 20),
          });
          this.delete(sessionId).catch(() => void 0);
          return null;
        }
      } else {
        parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      }

      const result = storedSessionSchema.safeParse(parsed);

      if (!result.success) {
        this.logger?.warn('[VercelKvSessionStore] Invalid session format', {
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
        this.logger?.info('[VercelKvSessionStore] Session exceeded max lifetime', {
          sessionId: sessionId.slice(0, 20),
          maxLifetimeAt: session.maxLifetimeAt,
        });
        await this.delete(sessionId);
        return null;
      }

      // Check application-level expiration (separate from KV TTL)
      if (session.session.expiresAt && session.session.expiresAt < Date.now()) {
        // Session is logically expired - delete it
        await this.delete(sessionId);
        return null;
      }

      // Bound TTL by session.expiresAt to avoid keeping expired sessions
      if (session.session.expiresAt) {
        const ttlMs = Math.min(this.defaultTtlMs, session.session.expiresAt - Date.now());
        if (ttlMs > 0 && ttlMs < this.defaultTtlMs) {
          // Fire-and-forget with logging - we're only optimizing cache eviction timing
          kv.pexpire(key, ttlMs).catch((err) => {
            this.logger?.warn('[VercelKvSessionStore] TTL bound extension failed', {
              sessionId: sessionId.slice(0, 20),
              error: (err as Error).message,
            });
          });
        }
      }

      // Update last accessed timestamp (in the returned object)
      const updatedSession: StoredSession = {
        ...session,
        lastAccessedAt: Date.now(),
      };

      return updatedSession;
    } catch (error) {
      this.logger?.warn('[VercelKvSessionStore] Failed to parse session', {
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
    const kv = await this.ensureConnected();
    const key = this.key(sessionId);

    // Apply HMAC signing if enabled
    let value: string;
    if (this.security.enableSigning) {
      value = signSession(session, { secret: this.security.signingSecret });
    } else {
      value = JSON.stringify(session);
    }

    if (ttlMs && ttlMs > 0) {
      // Use px for millisecond precision
      await kv.set(key, value, { px: ttlMs });
    } else if (session.session.expiresAt) {
      // Use session's expiration if available
      const ttl = session.session.expiresAt - Date.now();
      if (ttl > 0) {
        await kv.set(key, value, { px: ttl });
      } else {
        // Already expired, but store anyway (will be cleaned up on next access)
        await kv.set(key, value);
      }
    } else {
      // No TTL - session persists until explicitly deleted
      await kv.set(key, value);
    }
  }

  /**
   * Delete a session
   */
  async delete(sessionId: string): Promise<void> {
    const kv = await this.ensureConnected();
    await kv.del(this.key(sessionId));
  }

  /**
   * Check if a session exists
   */
  async exists(sessionId: string): Promise<boolean> {
    const kv = await this.ensureConnected();
    return (await kv.exists(this.key(sessionId))) === 1;
  }

  /**
   * Allocate a new session ID
   */
  allocId(): string {
    return randomUUID();
  }

  /**
   * Disconnect from Vercel KV
   * Vercel KV uses REST API, so there's no persistent connection to close
   */
  async disconnect(): Promise<void> {
    this.kv = null;
    this.connectPromise = null;
  }

  /**
   * Test Vercel KV connection by setting and getting a test key.
   * Useful for validating connection on startup.
   *
   * @returns true if connection is healthy, false otherwise
   */
  async ping(): Promise<boolean> {
    try {
      const kv = await this.ensureConnected();
      const testKey = `${this.keyPrefix}__ping__`;
      await kv.set(testKey, 'pong', { ex: 1 });
      const result = await kv.get<string>(testKey);
      return result === 'pong';
    } catch {
      return false;
    }
  }
}
