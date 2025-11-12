/**
 * Token Introspection — POST /oauth/introspect
 *
 * Who calls: Resource servers (API gateways).
 *
 * Purpose: Check if a token is active and fetch metadata (subject, scopes, expiry)
 * when you use opaque tokens or want server-side validation (RFC 7662).
 */

/**
 * Typical parameter shapes
 *
 * /oauth/introspect (POST): token, optional token_type_hint
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
