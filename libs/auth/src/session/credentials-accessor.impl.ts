/**
 * CredentialsAccessorImpl — request-scoped implementation of the
 * `this.credentials` accessor (Checkpoint 3b).
 *
 * Binds a {@link SessionCredentialVault} to the current request's authenticated
 * subject and signing secret. The subject is resolved lazily via the injected
 * `resolveSub` callback (so an anonymous/unauthenticated request yields no
 * credentials), and `requireConnect` mints a framework-signed resume URL using
 * {@link signCredentialResumeToken}.
 */

import { noopAuthLogger, type AuthLogger } from '../common/auth-logger.interface';
import { buildCredentialResumeUrl, signCredentialResumeToken } from './credential-resume-link';
import {
  type CredentialsAccessor,
  type CredentialValue,
  type RequireConnectOptions,
  type RequireConnectResult,
} from './credentials-accessor';
import { type SessionCredentialVault } from './session-credential-vault';

/**
 * Dependencies for {@link CredentialsAccessorImpl}.
 */
export interface CredentialsAccessorDeps {
  /** The per-session credential vault. */
  vault: SessionCredentialVault;
  /**
   * Resolve the current request's authenticated subject. Returns undefined for
   * anonymous/unauthenticated requests (no credentials are exposed then).
   */
  resolveSub: () => string | undefined;
  /** Server HMAC signing secret used for resume tokens. */
  signingSecret: string;
  /** Auth scope base path used to build the resume URL (e.g. `https://host/mcp`). */
  basePath: string;
  /** Resume-token TTL in ms (short-lived). */
  resumeTtlMs?: number;
  /** Scoped logger. */
  logger?: AuthLogger;
}

export class CredentialsAccessorImpl implements CredentialsAccessor {
  private readonly vault: SessionCredentialVault;
  private readonly resolveSub: () => string | undefined;
  private readonly signingSecret: string;
  private readonly basePath: string;
  private readonly resumeTtlMs?: number;
  private readonly logger: AuthLogger;

  constructor(deps: CredentialsAccessorDeps) {
    this.vault = deps.vault;
    this.resolveSub = deps.resolveSub;
    this.signingSecret = deps.signingSecret;
    this.basePath = deps.basePath;
    this.resumeTtlMs = deps.resumeTtlMs;
    this.logger = deps.logger ?? noopAuthLogger;
  }

  async get(key: string): Promise<CredentialValue | undefined> {
    const sub = this.resolveSub();
    if (!sub) return undefined;
    return this.vault.get(sub, key);
  }

  async list(): Promise<string[]> {
    const sub = this.resolveSub();
    if (!sub) return [];
    return this.vault.list(sub);
  }

  async requireConnect(options: RequireConnectOptions): Promise<RequireConnectResult> {
    const { key, context } = options;
    const sub = this.resolveSub();
    if (sub) {
      const existing = await this.vault.get(sub, key);
      if (existing) {
        return { connected: true, key, credential: existing };
      }
    }

    // Not connected (or anonymous): mint a signed, short-lived resume URL bound
    // to this subject + key. When anonymous, sub is '' — the resume page will
    // re-derive the subject on submit, but the link still cannot target another
    // identity because the token is HMAC-signed and verified on the server.
    const token = signCredentialResumeToken(
      { sub: sub ?? '', key, context, ttlMs: this.resumeTtlMs },
      this.signingSecret,
    );
    const resumeUrl = buildCredentialResumeUrl(this.basePath, token);
    this.logger.debug(`CredentialsAccessor: credential "${key}" not connected; issued resume link`);
    return {
      connected: false,
      key,
      resumeUrl,
      message: `Credential "${key}" is not connected. Open the resume URL to connect it.`,
    };
  }
}
