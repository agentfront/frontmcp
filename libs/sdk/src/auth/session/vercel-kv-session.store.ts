/**
 * Vercel KV Session Store
 *
 * Session store implementation using Vercel KV (edge-compatible REST-based key-value store).
 * Uses dynamic import to avoid bundling @vercel/kv for non-Vercel deployments.
 *
 * @see https://vercel.com/docs/storage/vercel-kv
 */

import { randomUUID } from 'crypto';
import { SessionStore, StoredSession, storedSessionSchema } from './transport-session.types';
import { FrontMcpLogger } from '../../common/interfaces/logger.interface';
import type { VercelKvProviderOptions } from '../../common/types/options/redis.options';

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
}

/**
 * Vercel KV-backed session store implementation
 *
 * Provides persistent session storage for edge deployments using Vercel KV.
 * Sessions are stored as JSON with optional TTL.
 */
export class VercelKvSessionStore implements SessionStore {
  private kv: VercelKVClient | null = null;
  private readonly keyPrefix: string;
  private readonly defaultTtlMs: number;
  private readonly logger?: FrontMcpLogger;
  private readonly config: VercelKvSessionConfig;

  constructor(config: VercelKvSessionConfig | VercelKvProviderOptions, logger?: FrontMcpLogger) {
    this.config = config;
    this.keyPrefix = config.keyPrefix ?? 'mcp:session:';
    this.defaultTtlMs = config.defaultTtlMs ?? 3600000;
    this.logger = logger;
  }

  /**
   * Connect to Vercel KV
   * Uses dynamic import to avoid bundling @vercel/kv when not used
   */
  async connect(): Promise<void> {
    if (this.kv) return;

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
    if (!this.kv) {
      await this.connect();
    }
    return this.kv!;
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
   */
  async get(sessionId: string): Promise<StoredSession | null> {
    const kv = await this.ensureConnected();
    const key = this.key(sessionId);

    // Get the session
    const raw = await kv.get<string>(key);
    if (!raw) return null;

    // Extend TTL (fire-and-forget, similar to Redis GETEX behavior)
    kv.pexpire(key, this.defaultTtlMs).catch(() => void 0);

    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
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
          // Fire-and-forget - we're only optimizing cache eviction timing
          kv.pexpire(key, ttlMs).catch(() => void 0);
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
    const value = JSON.stringify(session);

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
