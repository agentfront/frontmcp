// auth/session/record/session.base.ts

import type { ProviderSnapshot, SessionMode } from '../session.types';
import type { TransportIdMode } from '../../../common';
import { TransportIdGenerator } from '../session.transport';
import { Scope } from '../../../scope';

export interface BaseCreateCtx {
  id: string;
  sessionId?: string;
  scope: Scope;
  issuer: string;
  token: string;
  user: SessionUser;
  claims?: SessionClaims;
  createdAt?: number;
  // optional precomputed authorization projections
  authorizedProviders?: Record<string, ProviderSnapshot>;
  authorizedProviderIds?: string[];
  authorizedApps?: Record<string, { id: string; toolIds: string[] }>;
  authorizedAppIds?: string[];
  authorizedResources?: string[];
  scopes?: string[];
  // Scoped tools/prompts maps
  authorizedTools?: Record<string, { executionPath: [string, string]; details?: Record<string, unknown> }>;
  authorizedToolIds?: string[];
  authorizedPrompts?: Record<string, { executionPath: [string, string]; details?: Record<string, unknown> }>;
  authorizedPromptIds?: string[];
}

// TODO: can be extended
export interface SessionUser {
  sub?: string;
  name?: string;
  email?: string;
  picture?: string;
}

// TODO: can be extended
export interface SessionClaims {
  [key: string]: unknown;
}

export abstract class Session {
  // ---------------- public immutable data ----------------
  readonly id: string;
  abstract readonly mode: SessionMode;
  readonly createdAt: number;
  readonly scopeId: string;
  readonly user: SessionUser;
  readonly claims?: Record<string, unknown>;
  /** Epoch millis when the bearer token expires (if available). */
  readonly expiresAt?: number;

  readonly authorizedProviders: Record<string, ProviderSnapshot>;
  readonly authorizedProviderIds: string[];
  readonly authorizedApps: Record<string, { id: string; toolIds: string[] }>;
  readonly authorizedAppIds: string[];
  readonly authorizedResources: string[];
  readonly scopes?: string[];
  readonly authorizedTools?: Record<string, { executionPath: [string, string]; details?: Record<string, unknown> }>;
  readonly authorizedToolIds?: string[];
  readonly authorizedPrompts?: Record<string, { executionPath: [string, string]; details?: Record<string, unknown> }>;
  readonly authorizedPromptIds?: string[];

  // ---------------- private/shared ----------------
  #scope: Scope;
  #issuer: string;
  protected token: string;

  #activeTransportId?: string;

  protected constructor(ctx: BaseCreateCtx) {
    this.id = ctx.id;
    this.createdAt = ctx.createdAt || Date.now();
    this.#scope = ctx.scope;
    this.#issuer = ctx.issuer;
    this.scopeId = ctx.scope.id;
    this.user = ctx.user;
    this.claims = ctx.claims;
    // derive token expiration from JWT claims if present (exp in seconds)
    const exp = ctx.claims && typeof ctx.claims['exp'] === 'number' ? Number(ctx.claims['exp']) : undefined;
    if (exp) {
      this.expiresAt = exp > 1e12 ? exp : exp * 1000;
    }
    // project authorized fields (defaults to empty)
    this.authorizedProviders = ctx.authorizedProviders ?? {};
    this.authorizedProviderIds = ctx.authorizedProviderIds ?? [];
    this.authorizedApps = ctx.authorizedApps ?? {};
    this.authorizedAppIds = ctx.authorizedAppIds ?? [];
    this.authorizedResources = ctx.authorizedResources ?? [];
    this.authorizedTools = ctx.authorizedTools ?? {};
    this.authorizedToolIds = ctx.authorizedToolIds ?? [];
    this.authorizedPrompts = ctx.authorizedPrompts ?? {};
    this.authorizedPromptIds = ctx.authorizedPromptIds ?? [];
    this.token = ctx.token;
    this.#activeTransportId = ctx.sessionId;
  }

  /**
   * Get the scope associated with this session.
   * Can be used by subclasses to implement custom scope handling.
   * @protected
   */
  protected get scope(): Scope {
    return this.#scope;
  }
  // ---------------- accessors ----------------

  get issuer(): string {
    return this.#issuer;
  }

  async getTransportSessionId(): Promise<string> {
    if (this.#activeTransportId) return this.#activeTransportId;
    const mode = this.scope.metadata.transport?.transportIdMode ?? 'uuid';
    if (typeof mode === 'string') {
      return TransportIdGenerator.createId(mode as TransportIdMode);
    } else {
      // Cast to proper function type since Zod's z.function() type is too generic
      const modeFn = mode as (issuer: string) => Promise<TransportIdMode> | TransportIdMode;
      const modeResult = await modeFn(this.issuer);
      return TransportIdGenerator.createId(modeResult);
    }
  }

  /**
   * Get the access token for a given provider.
   * Must be implemented in subclasses based on session topology.
   * @protected
   * @param providerId
   */
  abstract getToken(providerId?: string): Promise<string> | string;

  // ---------------- scoped view ----------------
  scoped(allowed: string | string[] | ((id: string) => boolean)) {
    const fn =
      typeof allowed === 'function'
        ? allowed
        : Array.isArray(allowed)
          ? (id: string) => allowed.includes(id)
          : (id: string) => id === allowed;
    return new SessionView(this, fn);
  }
}

export class SessionView {
  constructor(
    private readonly parent: Session,
    private readonly allow: (id: string) => boolean,
  ) {}

  get id() {
    return this.parent.id;
  }
  get mode() {
    return this.parent.mode;
  }
  get user() {
    return this.parent.user;
  }
  get claims() {
    return this.parent.claims;
  }
  get authorizedApps() {
    return this.parent.authorizedApps;
  }

  async getToken(providerId: string) {
    if (!this.allow(providerId)) throw new Error(`scoped_denied:${providerId}`);
    return this.parent.getToken(providerId);
  }
  get transportId() {
    return this.parent.getTransportSessionId;
  }
}
