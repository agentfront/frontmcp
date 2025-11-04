/**
 * Authorization Endpoint — GET /oauth/authorize
 *
 * Who calls: Browser via the Client (RP).
 *
 * When: Start of the flow.
 *
 * Purpose: Authenticate the user and obtain consent; returns an authorization code to the client’s redirect URI.
 *
 * Notes: Must support PKCE. Implicit/Hybrid are out in OAuth 2.1.
 */
/**
 * Typical parameter shapes
 *
 * /oauth/authorize (GET)
 *
 * response_type=code, client_id, redirect_uri, scope, state, code_challenge, code_challenge_method=S256, (optionally request_uri from PAR)
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
