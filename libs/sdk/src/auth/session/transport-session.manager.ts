// auth/session/transport-session.manager.ts

import { randomUUID, decryptValue, hkdfSha256, type EncryptedBlob } from '@frontmcp/utils';
import {
  TransportSession,
  TransportProtocol,
  SessionJwtPayload,
  StoredSession,
  SessionStore,
  SessionStorageConfig,
  TransportState,
} from './transport-session.types';
import { encryptJson } from './utils/session-id.utils';
import { getMachineId } from '../authorization/authorization.class';
import { RedisSessionStore } from './redis-session.store';

/**
 * In-memory session store implementation
 */
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, StoredSession>();

  async get(sessionId: string): Promise<StoredSession | null> {
    const stored = this.sessions.get(sessionId);
    if (!stored) return null;

    // Check absolute maximum lifetime (prevents indefinite session extension)
    if (stored.maxLifetimeAt && stored.maxLifetimeAt < Date.now()) {
      this.sessions.delete(sessionId);
      return null;
    }

    // Check expiration
    if (stored.session.expiresAt && stored.session.expiresAt < Date.now()) {
      this.sessions.delete(sessionId);
      return null;
    }

    // Update last accessed
    stored.lastAccessedAt = Date.now();
    return stored;
  }

  async set(sessionId: string, session: StoredSession, ttlMs?: number): Promise<void> {
    if (ttlMs) {
      session.session.expiresAt = Date.now() + ttlMs;
    }
    this.sessions.set(sessionId, session);
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async exists(sessionId: string): Promise<boolean> {
    const stored = this.sessions.get(sessionId);
    if (!stored) return false;

    // Check absolute maximum lifetime
    if (stored.maxLifetimeAt && stored.maxLifetimeAt < Date.now()) {
      this.sessions.delete(sessionId);
      return false;
    }

    // Check expiration
    if (stored.session.expiresAt && stored.session.expiresAt < Date.now()) {
      this.sessions.delete(sessionId);
      return false;
    }
    return true;
  }

  allocId(): string {
    return randomUUID();
  }

  /**
   * Clean up expired sessions
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, stored] of this.sessions) {
      // Check max lifetime
      if (stored.maxLifetimeAt && stored.maxLifetimeAt < now) {
        this.sessions.delete(id);
        cleaned++;
        continue;
      }
      // Check session expiration
      if (stored.session.expiresAt && stored.session.expiresAt < now) {
        this.sessions.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * Get count of active sessions
   */
  get size(): number {
    return this.sessions.size;
  }
}

/**
 * Transport Session Manager
 *
 * Manages transport sessions independent of authorization.
 * Supports both stateless (JWT-encrypted) and stateful (store-backed) modes.
 *
 * Key concepts:
 * - Authorization = User identity + permissions (1 per user token)
 * - TransportSession = Protocol-specific connection (N per authorization)
 * - One authorization can have multiple transport sessions (e.g., multiple browser tabs)
 */
export class TransportSessionManager {
  private readonly store: SessionStore;
  private readonly mode: 'stateless' | 'stateful';
  private readonly encryptionKey: Uint8Array;

  constructor(config: SessionStorageConfig & { encryptionSecret?: string }) {
    this.mode = config.mode;

    if (config.mode === 'stateless') {
      this.store = new InMemorySessionStore(); // Used only for allocation
    } else if (config.store === 'memory') {
      this.store = new InMemorySessionStore();
    } else if (config.store === 'redis') {
      // Instantiate Redis session store
      this.store = new RedisSessionStore(config.config);
    } else {
      this.store = new InMemorySessionStore();
    }

    // Derive encryption key from secret or generate one
    const secret = config.encryptionSecret || process.env['MCP_SESSION_SECRET'];
    if (!secret) {
      if (process.env['NODE_ENV'] === 'production') {
        throw new Error(
          '[TransportSessionManager] MCP_SESSION_SECRET or encryptionSecret is required in production. ' +
            'Set the MCP_SESSION_SECRET environment variable or provide encryptionSecret in config.',
        );
      }
      // Development fallback - NOT secure for production
      console.warn(
        '[TransportSessionManager] Using machine ID as session encryption secret - NOT SECURE FOR PRODUCTION. ' +
          'Set MCP_SESSION_SECRET or provide encryptionSecret in config.',
      );
    }
    const effectiveSecret = secret || getMachineId();
    const encoder = new TextEncoder();
    this.encryptionKey = hkdfSha256(
      encoder.encode(effectiveSecret),
      encoder.encode('mcp-session-salt'),
      encoder.encode('transport-session'),
      32,
    );
  }

  /**
   * Create a new transport session for an authorization
   *
   * @param authorizationId - The authorization this session belongs to
   * @param protocol - Transport protocol (sse, streamable-http, etc.)
   * @param options - Additional session options
   * @returns The created transport session
   */
  async createSession(
    authorizationId: string,
    protocol: TransportProtocol,
    options: {
      expiresAt?: number;
      fingerprint?: string;
      transportState?: TransportState;
      tokens?: Record<string, EncryptedBlob>;
    } = {},
  ): Promise<TransportSession> {
    const sessionId = this.store.allocId();

    const session: TransportSession = {
      id: sessionId,
      authorizationId,
      protocol,
      createdAt: Date.now(),
      expiresAt: options.expiresAt,
      nodeId: getMachineId(),
      clientFingerprint: options.fingerprint,
      transportState: options.transportState,
    };

    if (this.mode === 'stateful') {
      // Store session in persistent store
      const stored: StoredSession = {
        session,
        authorizationId,
        tokens: options.tokens,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      };
      await this.store.set(sessionId, stored);
    } else {
      // Stateless mode: encode session as JWT - the id becomes the encrypted JWT
      session.id = this.encodeSessionJwt(session);
    }

    return session;
  }

  /**
   * Get an existing session by ID
   *
   * @param sessionId - The session ID (encrypted JWT or UUID)
   * @returns The session if found and valid, null otherwise
   */
  async getSession(sessionId: string): Promise<TransportSession | null> {
    if (this.mode === 'stateless') {
      // Decrypt session from JWT
      return this.decryptSessionJwt(sessionId);
    }

    // Stateful: lookup in store
    const stored = await this.store.get(sessionId);
    return stored?.session ?? null;
  }

  /**
   * Get stored session with tokens (for orchestrated mode)
   */
  async getStoredSession(sessionId: string): Promise<StoredSession | null> {
    if (this.mode === 'stateless') {
      // In stateless mode, we don't have stored sessions
      return null;
    }
    return this.store.get(sessionId);
  }

  /**
   * Update session state
   */
  async updateSession(
    sessionId: string,
    updates: {
      transportState?: TransportState;
      expiresAt?: number;
    },
  ): Promise<boolean> {
    if (this.mode === 'stateless') {
      // Stateless sessions are immutable - caller should create new session JWT
      return false;
    }

    const stored = await this.store.get(sessionId);
    if (!stored) return false;

    if (updates.transportState) {
      stored.session.transportState = updates.transportState;
    }
    if (updates.expiresAt) {
      stored.session.expiresAt = updates.expiresAt;
    }
    stored.lastAccessedAt = Date.now();

    await this.store.set(sessionId, stored);
    return true;
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    if (this.mode === 'stateless') {
      // Stateless sessions can't be revoked
      return false;
    }

    const exists = await this.store.exists(sessionId);
    if (exists) {
      await this.store.delete(sessionId);
    }
    return exists;
  }

  /**
   * Encode a session as an encrypted JWT for the Mcp-Session-Id header
   *
   * @param session - The transport session to encode
   * @returns Encrypted session JWT
   */
  encodeSessionJwt(session: TransportSession): string {
    const payload: SessionJwtPayload = {
      sid: session.id,
      aid: session.authorizationId,
      proto: session.protocol,
      nid: session.nodeId,
      iat: Math.floor(Date.now() / 1000),
      exp: session.expiresAt ? Math.floor(session.expiresAt / 1000) : undefined,
    };

    return encryptJson(payload);
  }

  /**
   * Decode an encrypted session JWT
   *
   * @param jwt - The encrypted session JWT
   * @returns Decoded session or null if invalid
   */
  private decryptSessionJwt(jwt: string): TransportSession | null {
    try {
      // The encryptJson format is iv.tag.ct (base64url)
      // We need to decrypt it using the same key
      const parts = jwt.split('.');
      if (parts.length !== 3) return null;

      const [ivB64, tagB64, ctB64] = parts;

      const payload = decryptValue<SessionJwtPayload>(
        { alg: 'A256GCM', iv: ivB64, tag: tagB64, data: ctB64 },
        this.encryptionKey,
      );

      // Validate expiration
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        return null;
      }

      return {
        id: payload.sid,
        authorizationId: payload.aid,
        protocol: payload.proto,
        createdAt: payload.iat * 1000,
        expiresAt: payload.exp ? payload.exp * 1000 : undefined,
        nodeId: payload.nid,
      };
    } catch (err) {
      if (process.env['NODE_ENV'] !== 'production') {
        console.debug('[TransportSessionManager] Failed to decrypt session JWT:', err);
      }
      return null;
    }
  }

  /**
   * Check if a session exists and is valid
   */
  async sessionExists(sessionId: string): Promise<boolean> {
    if (this.mode === 'stateless') {
      const session = this.decryptSessionJwt(sessionId);
      return session !== null;
    }
    return this.store.exists(sessionId);
  }

  /**
   * Get the storage mode
   */
  get storageMode(): 'stateless' | 'stateful' {
    return this.mode;
  }
}
