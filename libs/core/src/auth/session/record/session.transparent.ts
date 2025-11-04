import { BaseCreateCtx, Session } from './session.base';

interface TransparentCreateCtx extends BaseCreateCtx {
  apps: string[];
}

/**
 * Represents a transparent (Non-Orchestrated) session where delivered by authorization server.
 * The session cannot have nest auth providers.
 * The session cannot be refreshed.
 * The session cannot be revoked.
 * Useful for OAuth flows where the authorization server delivers the session.
 */
export class TransparentSession extends Session {
  readonly mode = 'transparent';
  constructor(ctx: TransparentCreateCtx) {
    super(ctx as any);
  }

  override getToken(): Promise<string> | string {
    return this.token;
  }
}
