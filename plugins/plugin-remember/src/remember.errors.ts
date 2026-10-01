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

/**
 * Raised when a memory tool is called with a scope outside `tools.allowedScopes`, including the
 * default scope when the caller omitted one. The model needs the message to retry with a valid
 * scope, so it is public rather than an internal-error notice.
 */
export class RememberScopeNotAllowedError extends PublicMcpError {
  override readonly name = 'RememberScopeNotAllowedError';

  constructor(scope: string, allowedScopes: readonly string[]) {
    super(
      `Scope '${scope}' is not allowed. Allowed scopes: ${allowedScopes.join(', ')}`,
      'REMEMBER_SCOPE_NOT_ALLOWED',
      400,
    );
  }
}
