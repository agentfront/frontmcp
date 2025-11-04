/**
 * Pushed Authorization Requests (PAR) — POST /oauth/par
 *
 * Who calls: Client (before sending user to /authorize).
 *
 * Purpose: Client uploads the full authorization request; you return a request_uri the client forwards to /authorize.
 *
 * Why: Prevents parameter tampering and URL-length issues; recommended for high-security setups and with DPoP/JAR.
 */
/**
 * Typical parameter shapes

 * /oauth/par (POST): same authz params as /authorize (client-authenticated), returns { request_uri, expires_in }
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
