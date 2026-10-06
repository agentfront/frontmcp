// server/transport/transport.registry.ts
import type { SessionStore, StoredSession } from '@frontmcp/auth';
import { getMachineId, sha256Hex } from '@frontmcp/utils';

import { createSessionStore, type SessionStoreFactoryOptions } from '../auth/session/session-store.factory';
import { isDeploymentSessionId } from '../auth/session/utils/session-id.utils';
import type { ServerRequest, ServerResponse, TransportPersistenceConfigInput } from '../common';
import type { RedisOptions } from '../common/types/options/redis';
import { sessionIdPresentedBy } from '../common/utils/auth-info.utils';
import { InvalidTransportSessionError, SessionClaimConflictError } from '../errors/transport.errors';
import type { ClaimedSessionInfo } from '../ha';
import type { ClientCapabilities } from '../notification/notification.service';
import type { Scope } from '../scope';
import HandleMcp20260728Flow from './flows/handle.mcp-20260728.flow';
import HandleSseFlow from './flows/handle.sse.flow';
import HandleStatelessHttpFlow from './flows/handle.stateless-http.flow';
import HandleStreamableHttpFlow from './flows/handle.streamable-http.flow';
import { isRelayedRequest } from './relay/relay-http';
import { LocalTransporter } from './transport.local';
import { RemoteTransporter } from './transport.remote';
import {
  STATELESS_SESSION_ID,
  type RemoteLocation,
  type TransportBus,
  type Transporter,
  type TransportKey,
  type TransportRegistryBucket,
  type TransportTokenBucket,
  type TransportType,
  type TransportTypeBucket,
} from './transport.types';

/** Backoff bounds for reconnecting a session store that was unreachable at startup. */
const SESSION_STORE_RETRY_BASE_MS = 1000;
const SESSION_STORE_RETRY_MAX_MS = 30000;

/** How often a node re-advertises a session it keeps serving (the bus entry lives one hour). */
const BUS_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

/** Longest session id the distributed routing looks up (ids are ~200 characters). */
const MAX_ROUTABLE_SESSION_ID_LENGTH = 4096;

/** Session protocols that live on one node and can be relayed to it. */
const RELAYABLE_TYPES: ReadonlySet<TransportType> = new Set<TransportType>(['streamable-http', 'sse']);

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
   * Session store for transport persistence (Redis or Vercel KV)
   * Used to persist session metadata across server restarts
   */
  private sessionStore?: SessionStore & {
    ping?: () => Promise<boolean>;
    disconnect?: () => Promise<void>;
    /** SQLite stores expose synchronous (or void-returning async) close — releases the underlying file handle. */
    close?: () => void | Promise<void>;
  };

  /**
   * Transport persistence configuration
   * - `false`: Explicitly disabled
   * - `object`: Enabled with config (redis, defaultTtlMs)
   * - `undefined`: Not configured
   */
  private persistenceConfig?: false | TransportPersistenceConfigInput;

  /**
   * Pending store configuration for async initialization. Either a Redis/Vercel KV
   * shape or a `{ sqlite: ... }` shape — discriminated in `createSessionStore`.
   */
  private pendingStoreConfig?: SessionStoreFactoryOptions;

  /** Set when the configured backend is SQLite. Used for telemetry-only branching. */
  private backendKind: 'redis' | 'vercel-kv' | 'sqlite' | undefined;

  /**
   * Stable key prefix for transport session keys, persisted from config at construction time.
   * Unlike pendingStoreConfig (cleared after init), this remains available for HA takeover lookups.
   */
  private transportKeyPrefix = 'mcp:transport:';

  /**
   * Whether a session store backend was configured (regardless of current connection state).
   * Set once during constructor when persistence config has redis or sqlite.
   * Used by pingSessionStore() to distinguish "not configured" from "configured but unavailable".
   */
  private sessionStoreConfigured = false;

  /**
   * Mutex map for preventing concurrent transport creation for the same key.
   * Key: JSON-encoded {t: type, h: tokenHash, s: sessionId}, Value: Promise that resolves when creation completes
   */
  private readonly creationMutex: Map<string, Promise<Transporter>> = new Map();

  /**
   * Get the default TTL for session persistence.
   * Returns undefined if persistence is disabled or not configured.
   */
  private getDefaultTtlMs(): number | undefined {
    if (this.resolvedTtlMs !== undefined) return this.resolvedTtlMs;
    return typeof this.persistenceConfig === 'object' ? this.persistenceConfig?.defaultTtlMs : undefined;
  }

  /**
   * TTL resolved from `persistence.defaultTtlMs`, then `persistence.redis.defaultTtlMs`, then 1 hour.
   * Set only when a persistence backend is configured.
   */
  private resolvedTtlMs: number | undefined;

  /** Store config kept after a successful create so a failed ping can be retried. */
  private storeRetryConfig?: SessionStoreFactoryOptions;
  private storeRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private storeRetryAttempt = 0;
  private destroyed = false;

  /** Last time a request refreshed the stored session's TTL, by session id. */
  private readonly lastTtlRefreshAt = new Map<string, number>();

  /** Last time a request re-advertised a served session on the transport bus, by session id. */
  private readonly lastBusRefreshAt = new Map<string, number>();

  /** Session ids with a transport on this node (any type / token), with their transport count. */
  private readonly localSessionIds = new Map<string, number>();

  /** The HA liveness generation in which this node last confirmed it owns a local session, by session id. */
  private readonly ownershipGeneration = new Map<string, number>();

  /** Sessions whose local transports are being dropped because another node owns them now. */
  private readonly relinquishing = new Set<string>();

  /**
   * Redis key prefix under which session records are stored.
   * The session store appends `session:` to the transport key prefix.
   */
  getSessionKeyPrefix(): string {
    return `${this.transportKeyPrefix}session:`;
  }

  constructor(scope: Scope, persistenceConfig?: false | TransportPersistenceConfigInput, bus?: TransportBus) {
    this.scope = scope;
    this.persistenceConfig = persistenceConfig;
    this.distributed = !!bus;
    this.bus = bus;

    // Initialize session store if persistence is enabled. Simplified format:
    //   false       = explicitly disabled
    //   { redis }   = Redis/Vercel KV backend
    //   { sqlite }  = SQLite backend (issue #401)
    //   undefined   = not configured
    if (persistenceConfig !== false && persistenceConfig?.sqlite) {
      this.sessionStoreConfigured = true;
      this.backendKind = 'sqlite';
      const sqliteConfig = persistenceConfig.sqlite;
      // SQLite keys are managed by SqliteKvStore via keyPrefix; reuse the
      // same transport-namespace convention Redis uses.
      this.transportKeyPrefix = 'mcp:transport:';
      this.resolvedTtlMs = persistenceConfig.defaultTtlMs ?? 3600000;
      this.pendingStoreConfig = {
        sqlite: sqliteConfig,
        keyPrefix: this.transportKeyPrefix,
        defaultTtlMs: this.resolvedTtlMs,
      };

      this.scope.logger.info('[TransportService] sqlite session store will be initialized for transport persistence');
    } else if (persistenceConfig !== false && persistenceConfig?.redis) {
      this.sessionStoreConfigured = true;

      // Use factory to create appropriate session store based on provider
      const redisConfig = persistenceConfig.redis;
      const providerType = 'provider' in redisConfig ? redisConfig.provider : 'redis';
      this.backendKind = providerType === 'vercel-kv' ? 'vercel-kv' : 'redis';

      // Override keyPrefix for transport persistence (separate from auth sessions)
      // Cast to RedisOptions since we're modifying the config
      this.transportKeyPrefix = redisConfig.keyPrefix ?? 'mcp:transport:';
      this.resolvedTtlMs =
        persistenceConfig.defaultTtlMs ?? (redisConfig as { defaultTtlMs?: number }).defaultTtlMs ?? 3600000;
      this.pendingStoreConfig = {
        ...redisConfig,
        keyPrefix: this.transportKeyPrefix,
        defaultTtlMs: this.resolvedTtlMs,
      } as RedisOptions;

      this.scope.logger.info(
        `[TransportService] ${providerType} session store will be initialized for transport persistence`,
      );
    }

    this.storeRetryConfig = this.pendingStoreConfig;
    this.ready = this.initialize();
  }

  private async initialize() {
    if (this.pendingStoreConfig) {
      const connected = await this.connectSessionStore();
      // SQLite is a local file: a failure there does not heal by waiting.
      if (!connected && this.backendKind !== 'sqlite') this.scheduleSessionStoreRetry();
    }

    await this.scope.registryFlows(
      HandleStreamableHttpFlow,
      HandleSseFlow,
      HandleStatelessHttpFlow,
      HandleMcp20260728Flow,
    );
  }

  /**
   * Create the session store and validate the connection.
   * Returns true when the store is usable; on failure the store is left undefined.
   */
  private async connectSessionStore(): Promise<boolean> {
    const storeConfig = this.pendingStoreConfig ?? this.storeRetryConfig;
    if (!storeConfig) return false;

    try {
      const store = await createSessionStore(storeConfig, this.scope.logger.child('SessionStore'));
      // Cast to our extended type. Redis / VercelKV stores expose
      // `ping` + `disconnect`; the SQLite store exposes `close`. The
      // `destroy()` path below selects the right teardown method by
      // probing for both.
      this.sessionStore = store as SessionStore & {
        ping?: () => Promise<boolean>;
        disconnect?: () => Promise<void>;
        close?: () => void | Promise<void>;
      };
      this.pendingStoreConfig = undefined;
    } catch (error) {
      const err = error as Error & { cause?: Error };
      this.scope.logger.error('[TransportService] Failed to create session store - session persistence disabled', {
        error: err.message,
        cause: err.cause?.message,
      });
      return false;
    }

    const isConnected = this.sessionStore?.ping ? await this.sessionStore.ping() : true;
    if (!isConnected) {
      const providerType = this.backendKind ?? 'redis';
      this.scope.logger.error(`[TransportService] Failed to connect to ${providerType} - session persistence disabled`);
      // Use the same teardown path as `destroy()` so SQLite stores
      // close their file handles instead of leaking them.
      await this.teardownSessionStore().catch(() => void 0);
      return false;
    }

    this.scope.logger.info('[TransportService] Session store connection validated successfully');
    return true;
  }

  /**
   * Retry the session store with exponential backoff (1s doubling to 30s) so a Redis that
   * was down at startup is picked up when it comes back, and `/readyz` turns healthy.
   */
  private scheduleSessionStoreRetry(): void {
    if (this.destroyed || this.storeRetryTimer) return;
    const delay = Math.min(SESSION_STORE_RETRY_MAX_MS, SESSION_STORE_RETRY_BASE_MS * 2 ** this.storeRetryAttempt);
    this.storeRetryAttempt++;
    this.storeRetryTimer = setTimeout(() => {
      this.storeRetryTimer = undefined;
      void this.retrySessionStore();
    }, delay);
    this.storeRetryTimer.unref?.();
  }

  private async retrySessionStore(): Promise<void> {
    if (this.destroyed || this.sessionStore) return;
    const connected = await this.connectSessionStore().catch(() => false);
    if (this.destroyed) {
      await this.teardownSessionStore().catch(() => void 0);
      return;
    }
    if (connected) {
      this.storeRetryAttempt = 0;
      this.scope.logger.info('[TransportService] Session store recovered after startup failure');
      return;
    }
    this.scheduleSessionStoreRetry();
  }

  async destroy() {
    this.destroyed = true;
    if (this.storeRetryTimer) {
      clearTimeout(this.storeRetryTimer);
      this.storeRetryTimer = undefined;
    }
    this.lastTtlRefreshAt.clear();
    this.lastBusRefreshAt.clear();
    this.ownershipGeneration.clear();
    await this.teardownSessionStore();
  }

  /**
   * Drain the configured session store and clear the reference. Probes
   * for `disconnect` (Redis / VercelKV) first, then `close` (SQLite,
   * which owns a `better-sqlite3` Database handle and MUST be closed
   * to release the file descriptor). Both the normal `destroy()` and
   * the startup ping-failure path route through here so SQLite stores
   * never leak FDs.
   */
  private async teardownSessionStore(): Promise<void> {
    if (!this.sessionStore) return;
    const teardown = this.sessionStore.disconnect ?? this.sessionStore.close;
    if (!teardown) {
      this.sessionStore = undefined;
      return;
    }
    try {
      await Promise.resolve(teardown.call(this.sessionStore));
      this.scope.logger.info('[TransportService] Session store disconnected', {
        backendKind: this.backendKind ?? 'unknown',
      });
    } catch (error) {
      this.scope.logger.warn('[TransportService] Error disconnecting session store', {
        error: (error as Error).message,
        backendKind: this.backendKind ?? 'unknown',
      });
    } finally {
      // Drop the reference whether teardown succeeded or failed — both
      // `destroy()` and the ping-failure path want the store gone so
      // subsequent operations don't act on a half-dead handle.
      this.sessionStore = undefined;
    }
  }

  /**
   * Ping the session store to check connectivity.
   *
   * Returns:
   * - `true` if no persistence backend was configured (in-memory only)
   * - `false` if a backend was configured but is unavailable (creation failed or disconnected)
   * - the result of `store.ping()` if the backend is present and reachable
   */
  async pingSessionStore(): Promise<boolean> {
    if (!this.sessionStoreConfigured) return true;
    if (!this.sessionStore) return false; // configured but unavailable
    if (typeof this.sessionStore.ping === 'function') {
      return this.sessionStore.ping();
    }
    return true;
  }

  /** True when a backend (Redis / Vercel KV / SQLite) was wired at construction.
   *  Note: this reflects construction-time intent, not live connection state.
   *  A `false` here means no backend was configured at all; a `true` does NOT
   *  guarantee the store is currently reachable — use `pingSessionStore()` for
   *  that signal. */
  isSessionStoreConfigured(): boolean {
    return this.sessionStoreConfigured;
  }

  /** The backend kind selected at construction (`undefined` if none). Used by
   *  the orphan-sqlite WARN guard in scope.instance.ts and by error telemetry. */
  getBackendKind(): 'redis' | 'vercel-kv' | 'sqlite' | undefined {
    return this.backendKind;
  }

  /** The configured backend as an operator reads it in a log line. */
  private sessionStoreLabel(): string {
    switch (this.backendKind) {
      case 'sqlite':
        return 'SQLite';
      case 'vercel-kv':
        return 'Vercel KV';
      case 'redis':
        return 'Redis';
      default:
        return 'the session store';
    }
  }

  /**
   * Slide the stored session's TTL while this instance is serving it. Redis and Vercel KV
   * session stores extend the TTL on read, so a plain `get` is enough. Throttled per session
   * to a quarter of the TTL, fire-and-forget.
   */
  private refreshStoredSessionTtl(sessionId: string): void {
    const store = this.sessionStore;
    const ttlMs = this.getDefaultTtlMs();
    if (!store || !ttlMs || (this.backendKind !== 'redis' && this.backendKind !== 'vercel-kv')) return;

    const now = Date.now();
    const last = this.lastTtlRefreshAt.get(sessionId);
    if (last !== undefined && now - last < Math.max(1000, Math.floor(ttlMs / 4))) return;
    this.lastTtlRefreshAt.set(sessionId, now);

    store.get(sessionId).catch((err) => {
      this.scope.logger.warn('[TransportService] Failed to refresh session TTL', {
        sessionId: sessionId.slice(0, 20),
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async getTransporter(type: TransportType, token: string, sessionId: string): Promise<Transporter | undefined> {
    const key = this.keyOf(type, token, sessionId);

    // 1. Check local in-memory cache first
    const local = this.lookupLocal(key);
    if (local && (await this.holdsLocalSession(sessionId))) {
      this.refreshStoredSessionTtl(sessionId);
      this.refreshBusAdvertisement(key);
      return local;
    }

    // 2. Distributed: a session another LIVE node owns is served there, through the relay.
    //    A session whose owner stopped is not: the caller recreates it from the session store,
    //    which takes it over (recreateTransporter).
    if (this.distributed && this.bus) {
      const location = await this.bus.lookup(key);
      if (location) {
        if (await this.isNodeAlive(location.nodeId)) {
          return new RemoteTransporter(key, this.bus, location);
        }
        this.scope.logger.info('[HA] Session owner is gone — the session will be taken over', {
          sessionId: sessionId.slice(0, 20),
          previousNodeId: location.nodeId,
        });
      }
    }

    // Note: Redis-stored sessions require recreation via recreateTransporter()
    // Flows should use getStoredSession() to check if session exists in Redis,
    // then call recreateTransporter() with the response object.

    return undefined;
  }

  /**
   * Distributed routing: the node a request must be relayed to, because another live node
   * owns the session it presents. `undefined` means "serve it here": the session is local,
   * unknown, owned by this node, or owned by a node that stopped (this node takes it over).
   *
   * Runs before authentication — it only decides where the request is served; the owner
   * authenticates it. Only session ids this deployment minted cost a Redis lookup.
   */
  async findRemoteSessionOwner(request: ServerRequest): Promise<RemoteLocation | undefined> {
    if (!this.distributed || !this.bus?.canRelay() || isRelayedRequest(request)) return undefined;

    const sessionId = sessionIdPresentedBy(request);
    if (!sessionId || sessionId.length > MAX_ROUTABLE_SESSION_ID_LENGTH) return undefined;
    if (!isDeploymentSessionId(sessionId)) return undefined;

    try {
      if (this.localSessionIds.has(sessionId) && (await this.holdsLocalSession(sessionId))) return undefined;
      const owner = await this.lookupSessionOwner(sessionId);
      if (!owner || owner.nodeId === getMachineId()) return undefined;
      return (await this.isNodeAlive(owner.nodeId)) ? owner : undefined;
    } catch (error) {
      this.scope.logger.warn('[HA] Could not resolve the session owner — serving the request here', {
        sessionId: sessionId.slice(0, 20),
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * The node that owns a session: the transport bus entry, else the persisted session record.
   * `undefined` when neither knows the session.
   */
  async lookupSessionOwner(sessionId: string): Promise<RemoteLocation | undefined> {
    if (!this.bus) return undefined;
    const advertised = await this.bus.lookupOwner(sessionId);
    if (advertised) return advertised;

    const stored = this.sessionStore ? await this.sessionStore.get(sessionId) : null;
    const nodeId = stored?.session?.nodeId;
    if (!nodeId) return undefined;
    return { nodeId, channel: this.bus.channelOf(nodeId) };
  }

  /**
   * Relay a request to the node that owns its session and write that node's response.
   * @throws SessionOwnerUnreachableError when the owner could not serve it (nothing written yet).
   */
  async relayToSessionOwner(location: RemoteLocation, request: ServerRequest, response: ServerResponse): Promise<void> {
    if (!this.bus) throw new InvalidTransportSessionError('Session relay requires the distributed transport bus.');
    const sessionId = sessionIdPresentedBy(request) ?? '';
    await this.bus.proxyRequest(location, sessionId, request, response);
  }

  /**
   * The orphan scanner claimed a session of a stopped node for this node: point the
   * transport bus at this node, so every node relays the session's requests here. The
   * transport itself is recreated from the session store by the first request.
   */
  async adoptClaimedSession(sessionId: string, previousNodeId: string, info: ClaimedSessionInfo): Promise<void> {
    if (!this.bus) return;
    const type = info.protocol;
    if (!info.authorizationId || (type !== 'streamable-http' && type !== 'sse')) return;
    await this.bus.advertise({ type, token: '', tokenHash: info.authorizationId, sessionId });
    this.scope.logger.info('[HA] Adopted an orphaned session — this node now serves it', {
      sessionId: sessionId.slice(0, 20),
      previousNodeId,
    });
  }

  /**
   * Destroy this node's transports for a session (asked by another node through the relay).
   * @returns Whether a transport was found.
   */
  async destroyLocalSession(sessionId: string, reason?: string): Promise<boolean> {
    let found = false;
    for (const [type, typeBucket] of [...this.byType.entries()]) {
      if (!RELAYABLE_TYPES.has(type)) continue;
      for (const tokenBucket of [...typeBucket.values()]) {
        const transporter = tokenBucket.get(sessionId);
        if (!transporter) continue;
        found = true;
        await transporter.destroy(reason);
      }
    }
    return found;
  }

  /**
   * Whether this node still owns a session it holds a transport for. After a gap in this node's
   * heartbeat another node may have taken the session over: the persisted record decides, once per
   * liveness generation, and a session that moved is dropped here (its record is left to the new owner).
   * When the record cannot be read the session is served here, and checked again on its next request.
   */
  private async holdsLocalSession(sessionId: string): Promise<boolean> {
    const haManager = this.scope.haManager;
    const store = this.sessionStore;
    if (!this.distributed || !haManager || !store) return true;
    const generation = haManager.livenessGeneration();
    if (generation !== undefined && this.ownershipGeneration.get(sessionId) === generation) return true;

    let ownerNodeId: string | undefined;
    try {
      ownerNodeId = (await store.get(sessionId))?.session?.nodeId;
    } catch (error) {
      this.scope.logger.warn('[HA] Could not confirm this node still owns the session — serving it here', {
        sessionId: sessionId.slice(0, 20),
        error: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
    if (!ownerNodeId || ownerNodeId === getMachineId()) {
      if (generation !== undefined) this.ownershipGeneration.set(sessionId, generation);
      return true;
    }

    this.scope.logger.warn(
      '[HA] Another node took this session over while this node was unreachable — dropping it here',
      {
        sessionId: sessionId.slice(0, 20),
        ownerNodeId,
      },
    );
    this.relinquishing.add(sessionId);
    try {
      await this.destroyLocalSession(sessionId, 'the session moved to another node');
    } finally {
      this.relinquishing.delete(sessionId);
    }
    return false;
  }

  /** Whether a node's heartbeat is present (`true` when liveness cannot be determined). */
  private async isNodeAlive(nodeId: string): Promise<boolean> {
    const haManager = this.scope.haManager;
    if (!haManager) return true;
    try {
      return await haManager.isNodeAlive(nodeId);
    } catch {
      // Heartbeats unreadable: treat the owner as alive rather than take its session over.
      return true;
    }
  }

  /** Re-advertise a session this node serves, so its bus entry does not expire under it. */
  private refreshBusAdvertisement(key: TransportKey): void {
    if (!this.distributed || !this.bus || !RELAYABLE_TYPES.has(key.type)) return;
    const now = Date.now();
    const last = this.lastBusRefreshAt.get(key.sessionId);
    if (last !== undefined && now - last < BUS_REFRESH_INTERVAL_MS) return;
    this.lastBusRefreshAt.set(key.sessionId, now);
    this.bus.advertise(key).catch((err) => {
      this.scope.logger.warn('[HA] Failed to refresh the session advertisement', {
        sessionId: key.sessionId.slice(0, 20),
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /**
   * Get stored session from Redis (without creating a transport).
   * Used by flows to check if session exists and can be recreated.
   *
   * @param type - Transport type
   * @param token - Authorization token
   * @param sessionId - Session ID
   * @param options - Optional validation options
   * @param options.clientFingerprint - Client fingerprint for additional validation
   * @param options.warnOnFingerprintMismatch - If true, log warning on mismatch but still return session
   * @returns Stored session data if exists and token matches, undefined otherwise
   */
  async getStoredSession(
    type: TransportType,
    token: string,
    sessionId: string,
    options?: {
      clientFingerprint?: string;
      warnOnFingerprintMismatch?: boolean;
    },
  ): Promise<StoredSession | undefined> {
    if (!this.sessionStore || (type !== 'streamable-http' && type !== 'sse')) return undefined;

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

    // Optional: Validate client fingerprint if stored and provided
    if (options?.clientFingerprint && stored.session.clientFingerprint) {
      if (stored.session.clientFingerprint !== options.clientFingerprint) {
        this.scope.logger.warn('[TransportService] Client fingerprint mismatch', {
          sessionId: sessionId.slice(0, 20),
          storedFingerprint: stored.session.clientFingerprint.slice(0, 8),
          requestFingerprint: options.clientFingerprint.slice(0, 8),
        });
        // By default, reject mismatched fingerprints unless warnOnFingerprintMismatch is true
        if (!options.warnOnFingerprintMismatch) {
          return undefined;
        }
      }
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
   * A transporter that relays to `ownerNodeId` when that node is alive and the transport bus
   * is available; `undefined` when the owner stopped (its session can be taken over).
   */
  private async remoteOwnerTransporter(key: TransportKey, ownerNodeId: string): Promise<Transporter | undefined> {
    if (!this.distributed || !this.bus) return undefined;
    if (!(await this.isNodeAlive(ownerNodeId))) return undefined;
    return new RemoteTransporter(key, this.bus, { nodeId: ownerNodeId, channel: this.bus.channelOf(ownerNodeId) });
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

    // HA: a session another node owns is served by that node while it lives (relayed),
    // and taken over atomically once it has stopped.
    const currentNodeId = getMachineId();
    const ownerNodeId = storedSession.session.nodeId;
    let latestSession = storedSession;
    if (this.scope.haManager && ownerNodeId && ownerNodeId !== currentNodeId) {
      const remote = await this.remoteOwnerTransporter(key, ownerNodeId);
      if (remote) return remote;

      const sessionKey = `${this.getSessionKeyPrefix()}${sessionId}`;
      const result = await this.scope.haManager.attemptTakeover(sessionKey, ownerNodeId);
      if (result.claimed) {
        latestSession = { ...storedSession, reassignedAt: result.reassignedAt, reassignedFrom: ownerNodeId };
        this.scope.logger.info('[HA] Took over session from a stopped node', {
          sessionId: sessionId.slice(0, 20),
          previousNodeId: ownerNodeId,
        });
      } else {
        // Claimed first by another node (relay to it while it lives) or by this node's
        // orphan scanner (serve it here).
        const current = this.sessionStore ? await this.sessionStore.get(sessionId) : null;
        const newOwner = current?.session?.nodeId;
        if (newOwner !== currentNodeId) {
          const relayed = newOwner ? await this.remoteOwnerTransporter(key, newOwner) : undefined;
          if (relayed) return relayed;
          this.scope.logger.debug('[HA] Session already claimed by another pod', { sessionId: sessionId.slice(0, 20) });
          throw new SessionClaimConflictError(sessionId);
        }
        if (current) latestSession = current;
      }
    }

    // Mark session as recreated in history
    const historyKey = this.makeHistoryKey(key.type, key.tokenHash, sessionId);
    this.sessionHistory.set(historyKey, storedSession.createdAt);

    const sessionStore = this.sessionStore;
    const defaultTtlMs = this.getDefaultTtlMs();

    // Create new transport
    const transporter = new LocalTransporter(this.scope, key, res, () =>
      this.onSessionTransportDisposed(key, sessionId, sessionStore),
    );

    await transporter.ready();

    // Mark the transport as initialized since we're recreating from an initialized session
    // This sets the MCP SDK's _initialized flag so subsequent requests are not rejected
    // For backwards compatibility, treat missing 'initialized' field as true (old sessions were initialized)
    if (storedSession.initialized !== false) {
      transporter.markAsInitialized();
    }

    this.insertLocal(key, transporter);

    // Restore client capabilities from stored session so that
    // elicitation, root listing, and notification delivery work after recreation.
    // Capabilities were persisted during the original initialize handshake.
    if (storedSession.clientCapabilities) {
      this.scope.notifications.setClientCapabilities(sessionId, storedSession.clientCapabilities as ClientCapabilities);
      this.scope.logger.verbose('[TransportService] Restored client capabilities from stored session', {
        sessionId: sessionId.slice(0, 20),
      });
    }

    // Update session access time in Redis. The record names this node as the owner and keeps the
    // takeover's audit fields: writing back the record read before a takeover would lose both.
    if (sessionStore) {
      const updatedSession: StoredSession = {
        ...latestSession,
        session: { ...latestSession.session, nodeId: currentNodeId },
        lastAccessedAt: Date.now(),
      };
      sessionStore.set(sessionId, updatedSession, defaultTtlMs).catch((err) => {
        this.scope.logger.warn(`[TransportService] Failed to update session in ${this.sessionStoreLabel()}`, {
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
    const defaultTtlMs = this.getDefaultTtlMs();

    const transporter = new LocalTransporter(this.scope, key, res, () =>
      this.onSessionTransportDisposed(key, sessionId, sessionStore),
    );

    await transporter.ready();

    this.insertLocal(key, transporter);

    // Persist session to Redis (streamable-http and sse)
    if (sessionStore && (type === 'streamable-http' || type === 'sse')) {
      const storedSession: StoredSession = {
        session: {
          id: sessionId,
          authorizationId: key.tokenHash,
          protocol: type === 'sse' ? 'sse' : 'streamable-http',
          createdAt: Date.now(),
          nodeId: getMachineId(),
        },
        authorizationId: key.tokenHash,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        initialized: true, // Mark as initialized for session recreation
      };
      sessionStore.set(sessionId, storedSession, defaultTtlMs).catch((err) => {
        this.scope.logger.warn(`[TransportService] Failed to persist session to ${this.sessionStoreLabel()}`, {
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

  /** A session transport went away: forget it, and its bus entry and stored record unless another node owns them now. */
  private onSessionTransportDisposed(key: TransportKey, sessionId: string, sessionStore?: SessionStore): void {
    key.sessionId = sessionId;
    this.evictLocal(key);
    if (this.distributed && this.bus) {
      this.bus.revoke(key).catch(() => void 0);
    }
    if (sessionStore && !this.relinquishing.has(sessionId)) {
      sessionStore.delete(sessionId).catch(() => void 0);
    }
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

    throw new InvalidTransportSessionError('Invalid session: cannot destroy non-existent transporter.');
  }

  /**
   * Delete a session's stored record, as when its client ends it with DELETE (#713). Without
   * this a record whose transport is not live here (after a restart or a takeover) would bring
   * the deleted session back. A store failure is logged and rethrown, so the DELETE fails
   * instead of confirming a termination that did not persist.
   */
  async deleteStoredSession(sessionId: string): Promise<void> {
    if (!this.sessionStore) return;
    try {
      await this.sessionStore.delete(sessionId);
    } catch (err) {
      this.scope.logger.warn(`[TransportService] Failed to delete session from ${this.sessionStoreLabel()}`, {
        sessionId: sessionId.slice(0, 20),
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Update the stored session in Redis with client capabilities from the initialize handshake.
   * This ensures capabilities survive session recreation (e.g., after server restart or transport eviction).
   *
   * Best-effort: failures are logged but do not throw.
   * No-op when sessionStore is not configured.
   */
  async updateStoredSessionCapabilities(sessionId: string, clientCapabilities: Record<string, unknown>): Promise<void> {
    if (!this.sessionStore) return;

    try {
      const stored = await this.sessionStore.get(sessionId);
      if (!stored) {
        this.scope.logger.verbose('[TransportService] Cannot update capabilities: session not found in store', {
          sessionId: sessionId.slice(0, 20),
        });
        return;
      }

      const updatedSession: StoredSession = {
        ...stored,
        clientCapabilities,
        lastAccessedAt: Date.now(),
      };

      const defaultTtlMs = this.getDefaultTtlMs();
      await this.sessionStore.set(sessionId, updatedSession, defaultTtlMs);

      this.scope.logger.verbose('[TransportService] Persisted client capabilities to session store', {
        sessionId: sessionId.slice(0, 20),
      });
    } catch (err) {
      this.scope.logger.warn('[TransportService] Failed to persist client capabilities', {
        sessionId: sessionId.slice(0, 20),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Get or create a shared singleton transport for anonymous stateless requests.
   * All anonymous requests share the same transport instance.
   */
  async getOrCreateAnonymousStatelessTransport(type: TransportType, res: ServerResponse): Promise<Transporter> {
    const key = this.keyOf(type, '__anonymous__', STATELESS_SESSION_ID);
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
    const key = this.keyOf(type, token, STATELESS_SESSION_ID);
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
    if (this.sessionStore && (type === 'streamable-http' || type === 'sse')) {
      const stored = await this.getStoredSession(type, token, sessionId);
      return stored !== undefined;
    }

    return false;
  }

  /* --------------------------------- internals -------------------------------- */

  private sha256(value: string): string {
    return sha256Hex(value);
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
    if (!tokenBucket.has(key.sessionId)) {
      this.localSessionIds.set(key.sessionId, (this.localSessionIds.get(key.sessionId) ?? 0) + 1);
    }
    tokenBucket.set(key.sessionId, t);
    const generation = this.distributed ? this.scope.haManager?.livenessGeneration() : undefined;
    if (generation !== undefined) this.ownershipGeneration.set(key.sessionId, generation);

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
    this.lastTtlRefreshAt.delete(key.sessionId);
    this.lastBusRefreshAt.delete(key.sessionId);
    const typeBucket = this.byType.get(key.type);
    if (!typeBucket) return;
    const tokenBucket = typeBucket.get(key.tokenHash);
    if (!tokenBucket) return;
    if (tokenBucket.delete(key.sessionId)) {
      const remaining = (this.localSessionIds.get(key.sessionId) ?? 1) - 1;
      if (remaining > 0) this.localSessionIds.set(key.sessionId, remaining);
      else {
        this.localSessionIds.delete(key.sessionId);
        this.ownershipGeneration.delete(key.sessionId);
      }
    }
    if (tokenBucket.size === 0) typeBucket.delete(key.tokenHash);
    if (typeBucket.size === 0) this.byType.delete(key.type);
  }
}
