import { PublicMcpError } from '@frontmcp/sdk';

/**
 * Raised when Remember has no per-client identity to namespace storage with
 * (GHSA-225p-f8jh-f3rh).
 *
 * Failing the call is the point: the alternative is a namespace shared by every client,
 * which silently turns one caller's memory into another's. It is a public error, so the caller
 * reads why in every environment rather than an internal-error notice.
 */
export class RememberIdentityError extends PublicMcpError {
  override readonly name = 'RememberIdentityError';

  constructor(message: string) {
    super(message, 'REMEMBER_IDENTITY_REQUIRED', 403);
  }
}
