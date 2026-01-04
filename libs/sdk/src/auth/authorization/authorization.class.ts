// auth/authorization/authorization.class.ts

import { randomUUID } from '@frontmcp/utils';
import {
  Authorization,
  AuthorizationCreateCtx,
  AuthorizedPrompt,
  AuthorizedTool,
  AuthUser,
  LLMSafeAuthContext,
} from './authorization.types';
import { TransportSession, TransportProtocol, SessionJwtPayload } from '../session';
import { ProviderSnapshot } from '../session/session.types';
import { encryptJson } from '../session/utils/session-id.utils';
import { AuthMode } from '../../common';
import { getMachineId } from '../machine-id';

// Re-export getMachineId for backwards compatibility
export { getMachineId } from '../machine-id';

/**
 * Base Authorization class - represents authenticated user context
 * Subclasses implement mode-specific behavior (Public, Transparent, Orchestrated)
 */
export abstract class AuthorizationBase implements Authorization {
  readonly id: string;
  abstract readonly mode: AuthMode;
  readonly isAnonymous: boolean;
  readonly user: AuthUser;
  readonly claims?: Record<string, unknown>;
  readonly expiresAt?: number;
  readonly scopes: string[];
  readonly authorizedProviders: Record<string, ProviderSnapshot>;
  readonly authorizedProviderIds: string[];
  readonly authorizedApps: Record<string, { id: string; toolIds: string[] }>;
  readonly authorizedAppIds: string[];
  readonly authorizedTools: Record<string, AuthorizedTool>;
  readonly authorizedToolIds: string[];
  readonly authorizedPrompts: Record<string, AuthorizedPrompt>;
  readonly authorizedPromptIds: string[];
  readonly authorizedResources: string[];

  /** The original bearer token (for transparent mode) */
  protected readonly token?: string;

  /** Active transport sessions for this authorization */
  readonly #sessions: Map<string, TransportSession> = new Map();

  /** Creation timestamp */
  readonly createdAt: number;

  protected constructor(ctx: AuthorizationCreateCtx) {
    this.id = ctx.id;
    this.isAnonymous = ctx.isAnonymous;
    this.user = ctx.user;
    this.claims = ctx.claims;
    this.expiresAt = ctx.expiresAt;
    this.scopes = ctx.scopes ?? [];
    this.token = ctx.token;
    this.createdAt = Date.now();

    // Initialize authorization projections
    this.authorizedProviders = ctx.authorizedProviders ?? {};
    this.authorizedProviderIds = ctx.authorizedProviderIds ?? Object.keys(this.authorizedProviders);
    this.authorizedApps = ctx.authorizedApps ?? {};
    this.authorizedAppIds = ctx.authorizedAppIds ?? Object.keys(this.authorizedApps);
    this.authorizedTools = ctx.authorizedTools ?? {};
    this.authorizedToolIds = ctx.authorizedToolIds ?? Object.keys(this.authorizedTools);
    this.authorizedPrompts = ctx.authorizedPrompts ?? {};
    this.authorizedPromptIds = ctx.authorizedPromptIds ?? Object.keys(this.authorizedPrompts);
    this.authorizedResources = ctx.authorizedResources ?? [];
  }

  /**
   * Create a new transport session for this authorization
   * @param protocol - Transport protocol (sse, streamable-http, etc.)
   * @param fingerprint - Optional client fingerprint for tracking
   */
  createTransportSession(protocol: TransportProtocol, fingerprint?: string): TransportSession {
    const sessionId = randomUUID();

    const session: TransportSession = {
      id: sessionId,
      authorizationId: this.id,
      protocol,
      createdAt: Date.now(),
      expiresAt: this.expiresAt,
      nodeId: getMachineId(),
      clientFingerprint: fingerprint,
    };

    this.#sessions.set(session.id, session);
    return session;
  }

  /**
   * Get existing transport session by ID
   */
  getTransportSession(sessionId: string): TransportSession | undefined {
    return this.#sessions.get(sessionId);
  }

  /**
   * Get all active transport sessions
   */
  getAllSessions(): TransportSession[] {
    return Array.from(this.#sessions.values());
  }

  /**
   * Remove a transport session
   */
  removeTransportSession(sessionId: string): boolean {
    return this.#sessions.delete(sessionId);
  }

  /**
   * Get count of active sessions
   */
  get sessionCount(): number {
    return this.#sessions.size;
  }

  /**
   * Abstract: Get access token for a provider
   * Implementation varies by mode:
   * - Public: throws (no tokens)
   * - Transparent: returns the original bearer token
   * - Orchestrated: retrieves from vault/store
   */
  abstract getToken(providerId?: string): Promise<string>;

  /**
   * Check if a scope is granted
   */
  hasScope(scope: string): boolean {
    return this.scopes.includes(scope);
  }

  /**
   * Check if all scopes are granted
   */
  hasAllScopes(scopes: string[]): boolean {
    return scopes.every((s) => this.scopes.includes(s));
  }

  /**
   * Check if any scope is granted
   */
  hasAnyScope(scopes: string[]): boolean {
    return scopes.some((s) => this.scopes.includes(s));
  }

  /**
   * Check if a tool is authorized
   */
  canAccessTool(toolId: string): boolean {
    return toolId in this.authorizedTools || this.authorizedToolIds.includes(toolId);
  }

  /**
   * Check if a prompt is authorized
   */
  canAccessPrompt(promptId: string): boolean {
    return promptId in this.authorizedPrompts || this.authorizedPromptIds.includes(promptId);
  }

  /**
   * Check if an app is authorized.
   * Used for progressive authorization to determine if tools from this app can be executed.
   * @param appId - App ID to check
   */
  isAppAuthorized(appId: string): boolean {
    return appId in this.authorizedApps || this.authorizedAppIds.includes(appId);
  }

  /**
   * Build URL for progressive/incremental authorization.
   * Used when a tool requires authorization for an app that was skipped during initial auth.
   * @param appId - App ID that requires authorization
   * @param baseUrl - Base URL of the server
   */
  getProgressiveAuthUrl(appId: string, baseUrl: string): string {
    return `${baseUrl}/oauth/authorize?app=${encodeURIComponent(appId)}&mode=incremental`;
  }

  /**
   * Check if the authorization is expired
   */
  isExpired(): boolean {
    if (!this.expiresAt) return false;
    return Date.now() > this.expiresAt;
  }

  /**
   * Get time until expiration in milliseconds
   * Returns undefined if no expiration, negative if expired
   */
  getTimeToExpiry(): number | undefined {
    if (!this.expiresAt) return undefined;
    return this.expiresAt - Date.now();
  }

  /**
   * Convert a transport session to encrypted session JWT
   * This is what gets sent in the Mcp-Session-Id header
   */
  toSessionJwt(session: TransportSession): string {
    const payload: SessionJwtPayload = {
      sid: session.id,
      aid: this.id,
      proto: session.protocol,
      nid: session.nodeId,
      iat: Math.floor(Date.now() / 1000),
      exp: this.expiresAt ? Math.floor(this.expiresAt / 1000) : undefined,
    };
    return encryptJson(payload);
  }

  /**
   * Convert to LLM-safe context (no tokens exposed)
   */
  toLLMSafeContext(session: TransportSession): LLMSafeAuthContext {
    return {
      authorizationId: this.id,
      sessionId: session.id,
      mode: this.mode,
      isAnonymous: this.isAnonymous,
      user: {
        sub: this.user.sub,
        name: this.user.name,
      },
      scopes: this.scopes,
      authorizedToolIds: this.authorizedToolIds,
      authorizedPromptIds: this.authorizedPromptIds,
    };
  }

  /**
   * Validate that no tokens are leaked in data
   * Throws if JWT pattern detected
   */
  static validateNoTokenLeakage(data: unknown): void {
    const json = JSON.stringify(data);
    // Detect JWT pattern (header.payload.signature)
    if (/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(json)) {
      throw new Error('SECURITY: Token detected in data - potential LLM context leak');
    }
    // Detect sensitive field names
    const sensitiveFields = ['access_token', 'refresh_token', 'id_token', 'tokenEnc', 'secretRefId'];
    for (const field of sensitiveFields) {
      if (json.includes(`"${field}"`)) {
        throw new Error(`SECURITY: Sensitive field "${field}" detected - potential leak`);
      }
    }
  }
}
