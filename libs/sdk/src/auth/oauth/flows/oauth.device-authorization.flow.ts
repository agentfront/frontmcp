/**
 * Device Authorization — POST /oauth/device_authorization
 *
 * Who calls: Device/TV app.
 *
 * Purpose: Start the device flow (user completes authorization on a second screen).
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

/**
 *
 * OAuth 2.0 Device Authorization Grant (“device code flow”)
 * Who does what (at a glance)
 *
 * Device/TV/CLI (no browser)
 * Calls POST /oauth/device_authorization, shows the user a code + URL, and polls POST /oauth/token.
 *
 * User (on phone/laptop browser)
 * Visits the given verification_uri and authenticates using your normal OAuth login (whatever you already have). No new UI required beyond two tiny endpoints.
 *
 * Auth Server (you)
 * Stores the device transaction and, after the user authenticates, marks it as approved so the device’s /oauth/token polling succeeds.
 *
 * Endpoints you need (only two “new” ones)
 *
 * POST /oauth/device_authorization ✅ (device calls)
 *
 * POST /oauth/token with grant urn:ietf:params:oauth:grant-type:device_code ✅ (device polls)
 *
 * GET /activate ➜ “UI handler” (user lands here from verification_uri — this just redirects into your existing /oauth/authorize)
 *
 * GET /activate/callback ➜ “UI handler” (your existing flow returns here after the user logs in; you flip the device record to approved and show a basic “All set” page)
 *
 * That’s it. No pages with complex consent screens are required; reuse your normal /oauth/authorize
 */
