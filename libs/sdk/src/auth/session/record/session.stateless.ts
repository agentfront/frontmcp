import { Session, type BaseCreateCtx } from './session.base';
import { TokenVault } from '@frontmcp/auth';
import { InternalMcpError } from '../../../errors/mcp.error';

export type StatelessCreateCtx = BaseCreateCtx & Record<string, never>;

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
  // eslint-disable-next-line no-unused-private-class-members
  #vault: TokenVault;
  constructor(ctx: StatelessCreateCtx) {
    super(ctx as BaseCreateCtx);
    throw new InternalMcpError('StatelessSession not yet implemented', 'NOT_IMPLEMENTED');
  }
  override getToken(_providerId?: string): Promise<string> | string {
    throw new InternalMcpError('Token refresh not supported in stateless mode', 'NOT_IMPLEMENTED');
  }
}
