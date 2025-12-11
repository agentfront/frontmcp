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
import { ServerResponse } from '../common';
import { Scope } from '../scope';
import HandleStreamableHttpFlow from './flows/handle.streamable-http.flow';
import HandleSseFlow from './flows/handle.sse.flow';
import HandleStatelessHttpFlow from './flows/handle.stateless-http.flow';

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
   * Key: "type:tokenHash:sessionId", Value: creation timestamp
   */
  private readonly sessionHistory: Map<string, number> = new Map();
  private readonly MAX_SESSION_HISTORY = 10000;

  constructor(scope: Scope) {
    this.scope = scope;
    this.distributed = false; // get from scope metadata
    this.bus = undefined; // get from scope metadata
    if (this.distributed && !this.bus) {
      throw new Error('TransportRegistry: distributed=true requires a TransportBus implementation.');
    }

    this.ready = this.initialize();
  }

  private async initialize() {
    await this.scope.registryFlows(HandleStreamableHttpFlow, HandleSseFlow, HandleStatelessHttpFlow);
  }

  async destroy() {
    /* empty */
  }

  async getTransporter(type: TransportType, token: string, sessionId: string): Promise<Transporter | undefined> {
    const key = this.keyOf(type, token, sessionId);

    const local = this.lookupLocal(key);
    if (local) return local;

    if (this.distributed && this.bus) {
      const location = await this.bus.lookup(key);
      if (location) {
        return new RemoteTransporter(key, this.bus);
      }
    }

    return undefined;
  }

  async createTransporter(
    type: TransportType,
    token: string,
    sessionId: string,
    res: ServerResponse,
  ): Promise<Transporter> {
    const key = this.keyOf(type, token, sessionId);
    const existing = this.lookupLocal(key);
    if (existing) return existing;

    const transporter = new LocalTransporter(this.scope, key, res, () => {
      key.sessionId = sessionId;
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
   * @param type - Transport type (e.g., 'streamable-http', 'sse')
   * @param token - The authorization token
   * @param sessionId - The session ID to check
   * @returns true if session was ever created, false otherwise
   */
  wasSessionCreated(type: TransportType, token: string, sessionId: string): boolean {
    const tokenHash = this.sha256(token);
    const historyKey = `${type}:${tokenHash}:${sessionId}`;
    return this.sessionHistory.has(historyKey);
  }

  /* --------------------------------- internals -------------------------------- */

  private sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
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
    const historyKey = `${key.type}:${key.tokenHash}:${key.sessionId}`;
    this.sessionHistory.set(historyKey, Date.now());

    // Evict oldest entries if cache exceeds max size (LRU-like eviction)
    if (this.sessionHistory.size > this.MAX_SESSION_HISTORY) {
      const entries = [...this.sessionHistory.entries()].sort((a, b) => a[1] - b[1]);
      // Remove oldest 10% of entries
      const toEvict = Math.ceil(this.MAX_SESSION_HISTORY * 0.1);
      for (let i = 0; i < toEvict && i < entries.length; i++) {
        this.sessionHistory.delete(entries[i][0]);
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
