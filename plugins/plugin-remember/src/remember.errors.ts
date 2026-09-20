/**
 * Raised when Remember has no per-client identity to namespace storage with
 * (GHSA-225p-f8jh-f3rh).
 *
 * Failing the call is the point: the alternative is a namespace shared by every client,
 * which silently turns one caller's memory into another's.
 */
export class RememberIdentityError extends Error {
  override readonly name = 'RememberIdentityError';

  constructor(message: string) {
    super(message);
  }
}
