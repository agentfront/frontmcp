import { Session, type BaseCreateCtx } from './session.base';
import { TokenRefresher } from '../token.refresh';
import type { TokenStore } from '../token.store';
import type { TokenVault } from '@frontmcp/auth';
import { InternalMcpError } from '../../../errors/mcp.error';

export type StatefulCreateCtx = BaseCreateCtx & {};

/**
 * Represents a **stateful session** stored server-side (e.g., Redis).
 * Nested OAuth tokens are never exposed in the JWT; instead, they are
 * encrypted and persisted in Redis under a session key. The client only
 * receives a lightweight reference to that key.
 *
 * Advantages:
 * - Smaller JWT payloads and reduced token leakage risk.
 * - Can refresh nested provider tokens on the fly without requiring
 *   the user to re-authorize.
 * - Well suited for multi-app setups with short-lived OAuth tokens.
 */
export class StatefulSession extends Session {
  readonly mode = 'stateful';
  /**
   * Used to encrypt/decrypt nested provider tokens in #store.
   * @private
   */
  // eslint-disable-next-line no-unused-private-class-members
  #vault: TokenVault;
  /**
   * Used to store/retrieve encrypted nested provider tokens.
   * By default it will be a memory store, but can be replaced with a
   * persistent store like Redis by settings session.store in SecureMcp options
   * @private
   */
  // eslint-disable-next-line no-unused-private-class-members
  #store: TokenStore;

  /**
   * Per-provider refreshers (keyed by providerId).
   * Used to refresh nested provider tokens on the fly.
   * By default, it will use the default refresher, which is a simple
   * refresher that refreshes the token by calling the provider's refresh endpoint.
   *
   * If you want to use a custom refresher, you can set it by setting session.refresher in SecureMcp options
   * @private
   */
  // eslint-disable-next-line no-unused-private-class-members
  #refreshers: Record<string, TokenRefresher>;
  // eslint-disable-next-line no-unused-private-class-members
  #defaultRefresher: TokenRefresher;

  constructor(ctx: StatefulCreateCtx) {
    super(ctx as BaseCreateCtx);
    throw new InternalMcpError('StatefulSession not yet implemented', 'NOT_IMPLEMENTED');
  }

  override getToken(_providerId?: string): Promise<string> | string {
    throw new InternalMcpError('Method not implemented', 'NOT_IMPLEMENTED');
  }
  //
  // protected async attachProviderSecrets(p: ProviderInput): Promise<ProviderSnapshot> {
  //   const snap: ProviderSnapshot = {
  //     id: p.id,
  //     exp: p.exp,
  //     payload: p.payload,
  //     apps: p.apps?.map(a => ({ id: String(a.id), toolIds: (a.toolIds ?? []).map(String) })),
  //     embedMode: 'store-only',
  //   };
  //   if (p.token) snap.tokenEnc = encryptAesGcm(this.#key, p.token);
  //   else if (p.enc) snap.tokenEnc = p.enc;
  //   if (p.refreshToken) snap.refreshTokenEnc = encryptAesGcm(this.#key, p.refreshToken);
  //   return snap;
  // }
  //
  // protected async readAccessToken(providerId: string): Promise<string | undefined> {
  //   const s = this.authorizedProviders[providerId];
  //   if (!s?.tokenEnc) return undefined;
  //   return decryptAesGcm(this.#key, s.tokenEnc);
  // }
  //
  // protected readRefreshToken(providerId: string): string | undefined {
  //   const s = this.authorizedProviders[providerId];
  //   if (!s?.refreshTokenEnc) return undefined;
  //   return decryptAesGcm(this.#key, s.refreshTokenEnc);
  // }
  //
  // protected async persistRefreshedTokens(providerId: string, res: TokenRefreshResult): Promise<void> {
  //   const s = this.authorizedProviders[providerId];
  //   if (!s) return;
  //   if (res.accessToken) s.tokenEnc = encryptAesGcm(this.#key, res.accessToken);
  //   if (res.refreshToken) s.refreshTokenEnc = encryptAesGcm(this.#key, res.refreshToken);
  // }
}
