/**
 * UserInfo (OIDC) — GET/POST /oauth/userinfo (Only if you add OpenID Connect)
 *
 * Who calls: Client with access token.
 *
 * Purpose: Return standard user claims.
 *
 * Note: Requires the openid scope; if you do OIDC, also expose /.well-known/openid-configuration (separate from OAuth discovery).
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
