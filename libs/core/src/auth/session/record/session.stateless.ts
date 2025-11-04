import { Session, type BaseCreateCtx } from './session.base';
import { TokenVault } from '../token.vault';

export type StatefulCreateCtx = BaseCreateCtx & {};

/**
 * Represents a **stateful session (non-refreshable)** where nested OAuth
 * tokens cannot be refreshed server-side. When a nested provider token
 * expires, the user must re-authorize to obtain new credentials.
 *
 * Notes:
 * - Simpler flow, but degrades UX when tokens are short-lived.
 * - Prefer the refreshable stateful session for multi-app environments.
 */
export class StatelessSession extends Session {
  readonly mode = 'stateless';
  /**
   * Used to encrypt/decrypt nested provider tokens in #store.
   * @private
   */
  #vault: TokenVault;
  constructor(ctx: StatefulCreateCtx) {
    super(ctx as any);
    throw new Error('Method not implemented.');
  }
  override getToken(providerId?: string): Promise<string> | string {
    throw new Error('Method not implemented.');
  }
}
