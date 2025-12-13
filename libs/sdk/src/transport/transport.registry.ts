// server/transport/transport.registry.ts
import { createHash } from 'crypto';
import {
  TransportBus,
  Transporter,
  TransportKey,
  TransportRegistryBucket,
  TransportTokenBucket,
  TransportType,
  TransportTypeBucket,
} from './transport.types';
import { RemoteTransporter } from './transport.remote';
import { LocalTransporter } from './transport.local';
import { ServerResponse, TransportRecreationConfigInput } from '../common';
import { Scope } from '../scope';
import HandleStreamableHttpFlow from './flows/handle.streamable-http.flow';
import HandleSseFlow from './flows/handle.sse.flow';
import HandleStatelessHttpFlow from './flows/handle.stateless-http.flow';
import { RedisSessionStore, StoredSession } from '../auth/session';
import { getMachineId } from '../auth/authorization/authorization.class';

export class TransportService {
  readonly ready: Promise<void>;
  private readonly byType: TransportRegistryBucket = new Map();
  private readonly distributed: boolean;
  private readonly bus?: TransportBus;
  private readonly scope: Scope;

  /**
   * Session history cache for tracking if sessions were ever created.
   * Used to differentiate between "session never initialized" (HTTP 400) and
   * "session expired/terminated" (HTTP 404) per MCP Spec 2025-11-25.
   *
   * Key: JSON-encoded {type, tokenHash, sessionId}, Value: creation timestamp
   * Note: We use JSON instead of colon-delimiter because sessionId can contain colons.
   */
  private readonly sessionHistory: Map<string, number> = new Map();
  private readonly MAX_SESSION_HISTORY = 10000;

  /**
   * Redis session store for transport recreation
   * Used to persist session metadata across server restarts
   */
  private sessionStore?: RedisSessionStore;

  /**
   * Transport recreation configuration
   */
  private recreationConfig?: TransportRecreationConfigInput;

  /**
   * Mutex map for preventing concurrent transport creation for the same key.
   * Key: `${type}:${tokenHash}:${sessionId}`, Value: Promise that resolves when creation completes
   */
  private readonly creationMutex: Map<string, Promise<Transporter>> = new Map();

  constructor(scope: Scope, recreationConfig?: TransportRecreationConfigInput) {
    this.scope = scope;
    this.recreationConfig = recreationConfig;
    this.distributed = false; // get from scope metadata
    this.bus = undefined; // get from scope metadata
    if (this.distributed && !this.bus) {
      throw new Error('TransportRegistry: distributed=true requires a TransportBus implementation.');
    }

    // Initialize Redis session store if recreation is enabled
    if (recreationConfig?.enabled && recreationConfig.redis) {
      this.sessionStore = new RedisSessionStore(
        {
          host: recreationConfig.redis.host,
          port: recreationConfig.redis.port,
          password: recreationConfig.redis.password,
          db: recreationConfig.redis.db,
          tls: recreationConfig.redis.tls,
          keyPrefix: recreationConfig.redis.keyPrefix ?? 'mcp:transport:',
          defaultTtlMs: recreationConfig.defaultTtlMs ?? 3600000, // 1 hour default
        },
        this.scope.logger.child('RedisSessionStore'),
      );
      this.scope.logger.info('[TransportService] Redis session store initialized for transport recreation');
    }

    this.ready = this.initialize();
  }

  private async initialize() {
    // Validate Redis connection if session store is configured
    if (this.sessionStore) {
      const isConnected = await this.sessionStore.ping();
      if (!isConnected) {
        this.scope.logger.error('[TransportService] Failed to connect to Redis - session persistence disabled');
        // Nullify sessionStore to prevent silent failures on all subsequent operations
        // This ensures clean graceful degradation - sessions will only persist in memory
        await this.sessionStore.disconnect().catch(() => void 0);
        this.sessionStore = undefined;
      } else {
        this.scope.logger.info('[TransportService] Redis connection validated successfully');
      }
    }

    await this.scope.registryFlows(HandleStreamableHttpFlow, HandleSseFlow, HandleStatelessHttpFlow);
  }

  async destroy() {
    // Close Redis connection if it was created
    if (this.sessionStore) {
      await this.sessionStore.disconnect();
      this.scope.logger.info('[TransportService] Redis session store disconnected');
    }
  }

  async getTransporter(type: TransportType, token: string, sessionId: string): Promise<Transporter | undefined> {
    const key = this.keyOf(type, token, sessionId);

    // 1. Check local in-memory cache first
    const local = this.lookupLocal(key);
    if (local) return local;

    // 2. Check distributed bus (if enabled)
    if (this.distributed && this.bus) {
      const location = await this.bus.lookup(key);
      if (location) {
        return new RemoteTransporter(key, this.bus);
      }
    }

    // Note: Redis-stored sessions require recreation via recreateTransporter()
    // Flows should use getStoredSession() to check if session exists in Redis,
    // then call recreateTransporter() with the response object.

    return undefined;
  }

  /**
   * Get stored session from Redis (without creating a transport).
   * Used by flows to check if session exists and can be recreated.
   *
   * @param type - Transport type
   * @param token - Authorization token
   * @param sessionId - Session ID
   * @returns Stored session data if exists and token matches, undefined otherwise
   */
  async getStoredSession(type: TransportType, token: string, sessionId: string): Promise<StoredSession | undefined> {
    if (!this.sessionStore || type !== 'streamable-http') return undefined;

    const tokenHash = this.sha256(token);
    const stored = await this.sessionStore.get(sessionId);
    if (!stored) return undefined;

    // Verify the token hash matches
    if (stored.authorizationId !== tokenHash) {
      this.scope.logger.warn('[TransportService] Session token mismatch during lookup', {
        sessionId: sessionId.slice(0, 20),
        storedTokenHash: stored.authorizationId.slice(0, 8),
        requestTokenHash: tokenHash.slice(0, 8),
      });
      return undefined;
    }

    return stored;
  }

  /**
   * Recreate a transport from stored session data.
   * Must be called with a valid response object to create the actual transport.
   *
   * @param type - Transport type
   * @param token - Authorization token
   * @param sessionId - Session ID
   * @param storedSession - Previously stored session data
   * @param res - Server response object for the new transport
   * @returns The recreated transport
   */
  async recreateTransporter(
    type: TransportType,
    token: string,
    sessionId: string,
    storedSession: StoredSession,
    res: ServerResponse,
  ): Promise<Transporter> {
    const key = this.keyOf(type, token, sessionId);

    // Check if already recreated in memory
    const existing = this.lookupLocal(key);
    if (existing) return existing;

    // Use mutex to prevent concurrent recreation of the same transport
    // Use JSON encoding for mutex key (consistent with history key format, handles colons in sessionId)
    const mutexKey = JSON.stringify({ t: type, h: key.tokenHash, s: sessionId });
    const pendingCreation = this.creationMutex.get(mutexKey);
    if (pendingCreation) {
      // Another request is already recreating this transport - wait for it
      return pendingCreation;
    }

    // Recreate the transport with mutex protection
    const recreationPromise = this.doRecreateTransporter(key, sessionId, storedSession, res);
    this.creationMutex.set(mutexKey, recreationPromise);

    try {
      return await recreationPromise;
    } catch (error) {
      // Log recreation errors for debugging
      this.scope.logger.error('[TransportService] Failed to recreate transport from stored session', {
        sessionId: sessionId.slice(0, 20),
        error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
      });
      throw error;
    } finally {
      this.creationMutex.delete(mutexKey);
    }
  }

  /**
   * Internal method to actually recreate the transport (called with mutex protection)
   */
  private async doRecreateTransporter(
    key: TransportKey,
    sessionId: string,
    storedSession: StoredSession,
    res: ServerResponse,
  ): Promise<Transporter> {
    // Double-check in case another request completed while we were waiting
    const existing = this.lookupLocal(key);
    if (existing) return existing;

    this.scope.logger.info('[TransportService] Recreating transport from stored session', {
      sessionId: sessionId.slice(0, 20),
      protocol: storedSession.session.protocol,
      createdAt: storedSession.createdAt,
    });

    // Mark session as recreated in history
    const historyKey = this.makeHistoryKey(key.type, key.tokenHash, sessionId);
    this.sessionHistory.set(historyKey, storedSession.createdAt);

    const sessionStore = this.sessionStore;
    const recreationConfig = this.recreationConfig;

    // Create new transport
    const transporter = new LocalTransporter(this.scope, key, res, () => {
      key.sessionId = sessionId;
      this.evictLocal(key);
      if (this.distributed && this.bus) {
        this.bus.revoke(key).catch(() => void 0);
      }
      // Remove from Redis on dispose
      if (sessionStore) {
        sessionStore.delete(sessionId).catch(() => void 0);
      }
    });

    await transporter.ready();
    this.insertLocal(key, transporter);

    // Update session access time in Redis
    if (sessionStore) {
      const updatedSession: StoredSession = {
        ...storedSession,
        lastAccessedAt: Date.now(),
      };
      sessionStore.set(sessionId, updatedSession, recreationConfig?.defaultTtlMs).catch((err) => {
        this.scope.logger.warn('[TransportService] Failed to update session in Redis', {
          sessionId: sessionId.slice(0, 20),
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    if (this.distributed && this.bus) {
      await this.bus.advertise(key);
    }

    return transporter;
  }

  async createTransporter(
    type: TransportType,
    token: string,
    sessionId: string,
    res: ServerResponse,
  ): Promise<Transporter> {
    const key = this.keyOf(type, token, sessionId);

    // Check if already exists
    const existing = this.lookupLocal(key);
    if (existing) return existing;

    // Use mutex to prevent concurrent creation of the same transport
    // Use JSON encoding for mutex key (consistent with history key format, handles colons in sessionId)
    const mutexKey = JSON.stringify({ t: type, h: key.tokenHash, s: sessionId });
    const pendingCreation = this.creationMutex.get(mutexKey);
    if (pendingCreation) {
      // Another request is already creating this transport - wait for it
      return pendingCreation;
    }

    // Create the transport with mutex protection
    const creationPromise = this.doCreateTransporter(key, sessionId, res, type);
    this.creationMutex.set(mutexKey, creationPromise);

    try {
      return await creationPromise;
    } finally {
      this.creationMutex.delete(mutexKey);
    }
  }

  /**
   * Internal method to actually create the transport (called with mutex protection)
   */
  private async doCreateTransporter(
    key: TransportKey,
    sessionId: string,
    res: ServerResponse,
    type: TransportType,
  ): Promise<Transporter> {
    // Double-check in case another request completed while we were waiting
    const existing = this.lookupLocal(key);
    if (existing) return existing;

    const sessionStore = this.sessionStore;
    const recreationConfig = this.recreationConfig;

    const transporter = new LocalTransporter(this.scope, key, res, () => {
      key.sessionId = sessionId;
      this.evictLocal(key);
      if (this.distributed && this.bus) {
        this.bus.revoke(key).catch(() => void 0);
      }
      // Remove from Redis on dispose
      if (sessionStore) {
        sessionStore.delete(sessionId).catch(() => void 0);
      }
    });

    await transporter.ready();

    this.insertLocal(key, transporter);

    // Persist session to Redis for recreation (streamable-http only for now)
    if (sessionStore && type === 'streamable-http') {
      const storedSession: StoredSession = {
        session: {
          id: sessionId,
          authorizationId: key.tokenHash,
          protocol: 'streamable-http',
          createdAt: Date.now(),
          nodeId: getMachineId(),
        },
        authorizationId: key.tokenHash,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      };
      sessionStore.set(sessionId, storedSession, recreationConfig?.defaultTtlMs).catch((err) => {
        this.scope.logger.warn('[TransportService] Failed to persist session to Redis', {
          sessionId: sessionId.slice(0, 20),
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    if (this.distributed && this.bus) {
      await this.bus.advertise(key);
    }

    return transporter;
  }

  async destroyTransporter(type: TransportType, token: string, sessionId: string, reason?: string): Promise<void> {
    const key = this.keyOf(type, token, sessionId);

    const local = this.lookupLocal(key);
    if (local) {
      await local.destroy(reason);
      return;
    }

    if (this.distributed && this.bus) {
      const location = await this.bus.lookup(key);
      if (location) {
        await this.bus.destroyRemote(key, reason);
        return;
      }
    }

    throw new Error('Invalid session: cannot destroy non-existent transporter.');
  }

  /**
   * Get or create a shared singleton transport for anonymous stateless requests.
   * All anonymous requests share the same transport instance.
   */
  async getOrCreateAnonymousStatelessTransport(type: TransportType, res: ServerResponse): Promise<Transporter> {
    const key = this.keyOf(type, '__anonymous__', '__stateless__');
    const existing = this.lookupLocal(key);
    if (existing) return existing;

    // Create shared transport for all anonymous requests
    const transporter = new LocalTransporter(this.scope, key, res, () => {
      this.evictLocal(key);
      if (this.distributed && this.bus) {
        this.bus.revoke(key).catch(() => void 0);
      }
    });

    await transporter.ready();
    this.insertLocal(key, transporter);

    if (this.distributed && this.bus) {
      await this.bus.advertise(key);
    }

    return transporter;
  }

  /**
   * Get or create a singleton transport for authenticated stateless requests.
   * Each unique token gets its own singleton transport.
   */
  async getOrCreateAuthenticatedStatelessTransport(
    type: TransportType,
    token: string,
    res: ServerResponse,
  ): Promise<Transporter> {
    const key = this.keyOf(type, token, '__stateless__');
    const existing = this.lookupLocal(key);
    if (existing) return existing;

    // Create singleton transport for this token
    const transporter = new LocalTransporter(this.scope, key, res, () => {
      this.evictLocal(key);
      if (this.distributed && this.bus) {
        this.bus.revoke(key).catch(() => void 0);
      }
    });

    await transporter.ready();
    this.insertLocal(key, transporter);

    if (this.distributed && this.bus) {
      await this.bus.advertise(key);
    }

    return transporter;
  }

  /**
   * Check if a session was ever created (even if it's been terminated/evicted).
   * Used to differentiate between "session never initialized" (HTTP 400) and
   * "session expired/terminated" (HTTP 404) per MCP Spec 2025-11-25.
   *
   * Note: This is synchronous and only checks local history. For async Redis check,
   * use wasSessionCreatedAsync.
   *
   * @param type - Transport type (e.g., 'streamable-http', 'sse')
   * @param token - The authorization token
   * @param sessionId - The session ID to check
   * @returns true if session was ever created locally, false otherwise
   */
  wasSessionCreated(type: TransportType, token: string, sessionId: string): boolean {
    const tokenHash = this.sha256(token);
    const historyKey = this.makeHistoryKey(type, tokenHash, sessionId);
    return this.sessionHistory.has(historyKey);
  }

  /**
   * Async version that also checks Redis for session existence.
   * Used when we need to check if session was ever created across server restarts.
   */
  async wasSessionCreatedAsync(type: TransportType, token: string, sessionId: string): Promise<boolean> {
    // Check local history first (fast path)
    if (this.wasSessionCreated(type, token, sessionId)) {
      return true;
    }

    // Check Redis if available - use getStoredSession() to verify token hash
    // (sessionStore.exists() would leak session existence to unauthorized callers)
    if (this.sessionStore && type === 'streamable-http') {
      const stored = await this.getStoredSession(type, token, sessionId);
      return stored !== undefined;
    }

    return false;
  }

  /* --------------------------------- internals -------------------------------- */

  private sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  /**
   * Create a history key from components.
   * Uses JSON encoding to handle sessionIds that contain special characters.
   */
  private makeHistoryKey(type: string, tokenHash: string, sessionId: string): string {
    return JSON.stringify({ t: type, h: tokenHash, s: sessionId });
  }

  /**
   * Parse a history key back into components.
   * Returns undefined if the key is malformed.
   */
  private parseHistoryKey(key: string): { type: string; tokenHash: string; sessionId: string } | undefined {
    try {
      const parsed = JSON.parse(key);
      if (typeof parsed.t === 'string' && typeof parsed.h === 'string' && typeof parsed.s === 'string') {
        return { type: parsed.t, tokenHash: parsed.h, sessionId: parsed.s };
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private keyOf(type: TransportType, token: string, sessionId: string, sessionIdSse?: string): TransportKey {
    return {
      type,
      token,
      tokenHash: this.sha256(token),
      sessionId,
      sessionIdSse,
    };
  }

  private ensureTypeBucket(type: TransportType): TransportTypeBucket {
    let bucket = this.byType.get(type);
    if (!bucket) {
      bucket = new Map<string, TransportTokenBucket>();
      this.byType.set(type, bucket);
    }
    return bucket;
  }

  private ensureTokenBucket(typeBucket: TransportTypeBucket, tokenHash: string): TransportTokenBucket {
    let bucket = typeBucket.get(tokenHash);
    if (!bucket) {
      bucket = new Map<string, Transporter>();
      typeBucket.set(tokenHash, bucket);
    }
    return bucket;
  }

  private lookupLocal(key: TransportKey): Transporter | undefined {
    const typeBucket = this.byType.get(key.type);
    if (!typeBucket) return undefined;
    const tokenBucket = typeBucket.get(key.tokenHash);
    if (!tokenBucket) return undefined;
    return tokenBucket.get(key.sessionId);
  }

  private insertLocal(key: TransportKey, t: Transporter): void {
    const typeBucket = this.ensureTypeBucket(key.type);
    const tokenBucket = this.ensureTokenBucket(typeBucket, key.tokenHash);
    tokenBucket.set(key.sessionId, t);

    // Record session creation in history for HTTP 404 detection
    const historyKey = this.makeHistoryKey(key.type, key.tokenHash, key.sessionId);
    this.sessionHistory.set(historyKey, Date.now());

    // Evict oldest entries if cache exceeds max size
    // Only evict entries that don't have active transports (to avoid inconsistent state)
    if (this.sessionHistory.size > this.MAX_SESSION_HISTORY) {
      const entries = [...this.sessionHistory.entries()].sort((a, b) => a[1] - b[1]);
      // Try to remove oldest 10% of entries (skip those with active transports)
      const targetEvictions = Math.ceil(this.MAX_SESSION_HISTORY * 0.1);
      let evicted = 0;

      for (const [histKey] of entries) {
        if (evicted >= targetEvictions) break;

        // Parse history key to check if transport still exists
        const parsed = this.parseHistoryKey(histKey);
        if (!parsed) {
          // Invalid key format - safe to evict
          this.sessionHistory.delete(histKey);
          evicted++;
          continue;
        }

        const { type, tokenHash, sessionId } = parsed;
        const typeBucket = this.byType.get(type as TransportType);
        const tokenBucket = typeBucket?.get(tokenHash);
        const hasActiveTransport = tokenBucket?.has(sessionId) ?? false;

        // Only evict if there's no active transport for this session
        if (!hasActiveTransport) {
          this.sessionHistory.delete(histKey);
          evicted++;
        }
      }

      // Log warning if we couldn't evict enough entries (all have active transports)
      if (evicted < targetEvictions) {
        this.scope.logger.warn('[TransportService] Session history eviction: unable to free target memory', {
          targetEvictions,
          actualEvictions: evicted,
          currentSize: this.sessionHistory.size,
          maxSize: this.MAX_SESSION_HISTORY,
        });
      }
    }
  }

  private evictLocal(key: TransportKey): void {
    const typeBucket = this.byType.get(key.type);
    if (!typeBucket) return;
    const tokenBucket = typeBucket.get(key.tokenHash);
    if (!tokenBucket) return;
    tokenBucket.delete(key.sessionId);
    if (tokenBucket.size === 0) typeBucket.delete(key.tokenHash);
    if (typeBucket.size === 0) this.byType.delete(key.type);
  }
}
