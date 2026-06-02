/**
 * CredentialsAccessor — the `this.credentials` ToolContext API (Checkpoint 3b).
 *
 * Runtime accessor tools use to read per-session credentials persisted by a
 * local `authenticate()` verifier, and to ask the agent to connect a missing
 * credential mid-session via a framework-signed resume URL.
 *
 * Resolution of the request's authenticated `sub` and the server signing secret
 * is handled by the implementation ({@link CredentialsAccessorImpl}); tools only
 * see the small API below.
 */

import { type Token } from '@frontmcp/di';

import { type StoredCredential } from './session-credential-vault';

/**
 * A credential as returned to a tool: the secret plus optional non-secret
 * metadata. Identical in shape to {@link StoredCredential}.
 */
export type CredentialValue = StoredCredential;

/**
 * Structured "credential not connected" result returned by
 * {@link CredentialsAccessor.requireConnect} when the requested credential is
 * absent. Carries a framework-signed resume URL the agent/client can open to
 * have the user connect the credential mid-session.
 */
export interface CredentialNotConnected {
  /** Discriminator. Always `false` — the credential is not available. */
  connected: false;
  /** The credential key that is missing. */
  key: string;
  /** Framework-signed, short-lived URL that opens the add-credential page. */
  resumeUrl: string;
  /** Human-readable hint for the agent/user. */
  message: string;
}

/**
 * Successful resolution returned by {@link CredentialsAccessor.requireConnect}
 * when the credential IS present.
 */
export interface CredentialConnected {
  /** Discriminator. Always `true` — the credential is available. */
  connected: true;
  /** The credential key. */
  key: string;
  /** The resolved credential value. */
  credential: CredentialValue;
}

/** Discriminated union returned by {@link CredentialsAccessor.requireConnect}. */
export type RequireConnectResult = CredentialConnected | CredentialNotConnected;

/**
 * Options for {@link CredentialsAccessor.requireConnect}.
 */
export interface RequireConnectOptions {
  /** Credential key to require (e.g. provider id). */
  key: string;
  /**
   * Optional opaque context forwarded to `authenticate()` as `resume.context`
   * when the user connects the credential (e.g. which resource triggered it).
   */
  context?: string;
}

/**
 * Runtime accessor for per-session credentials, available on tool contexts as
 * `this.credentials`:
 *
 * ```typescript
 * @Tool({ name: 'call_api' })
 * class CallApiTool extends ToolContext {
 *   async execute(input: Input): Promise<Output> {
 *     const cred = await this.credentials.get('acme');
 *     if (!cred) {
 *       const res = await this.credentials.requireConnect({ key: 'acme' });
 *       if (!res.connected) return { connectUrl: res.resumeUrl };
 *     }
 *     // use cred.secret …
 *   }
 * }
 * ```
 */
export interface CredentialsAccessor {
  /**
   * Get a credential by key for the current request's subject. Returns
   * undefined when the subject is anonymous, has no live vault, or has no such
   * credential (or when decryption fails after a vault rotation).
   */
  get(key: string): Promise<CredentialValue | undefined>;

  /**
   * List the credential keys available to the current request's subject.
   * Empty when anonymous or when there is no live vault.
   */
  list(): Promise<string[]>;

  /**
   * Resolve a credential, returning a framework-signed resume URL when it is not
   * connected so the caller can prompt the user to connect it mid-session.
   */
  requireConnect(options: RequireConnectOptions): Promise<RequireConnectResult>;
}

/**
 * DI token for {@link CredentialsAccessor}. Resolved by the `this.credentials`
 * context extension.
 */
export const CREDENTIALS_ACCESSOR = Symbol.for('frontmcp:CREDENTIALS_ACCESSOR') as Token<CredentialsAccessor>;
