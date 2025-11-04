/**
 * Token Revocation — POST /oauth/revoke
 *
 * Who calls: Client.
 *
 * Purpose: Invalidate an access or refresh token early (RFC 7009).
 */
/**
 * Typical parameter shapes
 *
 * /oauth/revoke (POST): token, token_type_hint=access_token|refresh_token
 */
/**
 * Quick checklist (security & correctness)
 * - PKCE (S256) required for public clients (and basically for all).
 * - Use authorization code grant only (no implicit/hybrid).
 * - Rotate refresh tokens and bind them to client + user + scopes.
 * - Prefer private_key_jwt or mTLS for confidential clients.
 * - PAR + JAR recommended for higher security.
 * - Consider DPoP (proof-of-possession) to reduce token replay.
 * - Keep codes very short-lived (e.g., ≤60 s) and single-use.
 * - Publish discovery and JWKS, rotate keys safely.
 * - Decide JWT vs opaque access tokens; provide introspection if opaque.
 */
