/**
 * A native sign-in that failed. `code` is the authorization server's OAuth error code (`access_denied`,
 * `invalid_grant`, ...) when it sent one, else one of this client's: `discovery_failed`, `insecure_url`,
 * `state_mismatch`, `issuer_mismatch`, `missing_code`, `timeout`, `invalid_token_response`.
 */
export class NativeSignInError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'NativeSignInError';
  }
}
