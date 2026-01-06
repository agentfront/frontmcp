/**
 * PKCE (Proof Key for Code Exchange) utilities per RFC 7636
 *
 * PKCE is used to secure authorization flows by generating a cryptographically
 * random code verifier and deriving a code challenge using SHA-256.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7636
 */

import { randomBytes, sha256, base64urlEncode } from '../';

/**
 * Minimum length for code verifier per RFC 7636
 */
export const MIN_CODE_VERIFIER_LENGTH = 43;

/**
 * Maximum length for code verifier per RFC 7636
 */
export const MAX_CODE_VERIFIER_LENGTH = 128;

/**
 * Default length for code verifier (64 chars provides ~384 bits of entropy)
 */
export const DEFAULT_CODE_VERIFIER_LENGTH = 64;

/**
 * Error thrown when PKCE parameters are invalid
 */
export class PkceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PkceError';
  }
}

/**
 * Generate a cryptographically random code verifier.
 *
 * The code verifier is a high-entropy cryptographic random string used in PKCE.
 * It should be stored securely and never exposed to external systems.
 *
 * @param length - Length of verifier (43-128 chars per RFC 7636, default 64)
 * @returns Base64url-encoded random string
 * @throws {PkceError} If length is outside allowed range
 *
 * @example
 * ```typescript
 * const verifier = generateCodeVerifier(); // 64 chars (default)
 * const shortVerifier = generateCodeVerifier(43); // minimum length
 * const longVerifier = generateCodeVerifier(128); // maximum length
 * ```
 */
export function generateCodeVerifier(length: number = DEFAULT_CODE_VERIFIER_LENGTH): string {
  if (length < MIN_CODE_VERIFIER_LENGTH || length > MAX_CODE_VERIFIER_LENGTH) {
    throw new PkceError(
      `Code verifier length must be between ${MIN_CODE_VERIFIER_LENGTH} and ${MAX_CODE_VERIFIER_LENGTH} characters (got ${length})`,
    );
  }

  // Calculate bytes needed: base64url encoding produces ~4/3 chars per byte
  // We generate extra bytes and truncate to exact length
  const bytesNeeded = Math.ceil((length * 6) / 8);
  const bytes = randomBytes(bytesNeeded);
  return base64urlEncode(bytes).slice(0, length);
}

/**
 * Generate a code challenge from a code verifier using S256 method.
 *
 * The code challenge is derived by applying SHA-256 to the code verifier
 * and base64url encoding the result. This is the only method specified
 * in RFC 7636 for security-sensitive applications.
 *
 * @param codeVerifier - The code verifier string
 * @returns Base64url-encoded SHA-256 hash of the verifier
 *
 * @example
 * ```typescript
 * const verifier = generateCodeVerifier();
 * const challenge = generateCodeChallenge(verifier);
 * // Send `challenge` to external system, keep `verifier` secret
 * ```
 */
export function generateCodeChallenge(codeVerifier: string): string {
  const verifierBytes = new TextEncoder().encode(codeVerifier);
  const hash = sha256(verifierBytes);
  return base64urlEncode(hash);
}

/**
 * Verify that a code verifier matches a code challenge.
 *
 * This validates that SHA256(base64url(code_verifier)) === code_challenge.
 * Used to verify callback responses in webhook/OAuth flows.
 *
 * @param codeVerifier - The original code verifier
 * @param codeChallenge - The code challenge to verify against
 * @returns true if the verifier produces the expected challenge
 *
 * @example
 * ```typescript
 * // When callback arrives with code_verifier
 * const isValid = verifyCodeChallenge(callbackVerifier, storedChallenge);
 * if (!isValid) {
 *   throw new Error('PKCE validation failed');
 * }
 * ```
 */
export function verifyCodeChallenge(codeVerifier: string, codeChallenge: string): boolean {
  const computedChallenge = generateCodeChallenge(codeVerifier);
  return computedChallenge === codeChallenge;
}

/**
 * Result of generating a PKCE pair
 */
export interface PkcePair {
  /** The secret code verifier (keep secure, never expose externally) */
  codeVerifier: string;
  /** The code challenge derived from the verifier (safe to share) */
  codeChallenge: string;
}

/**
 * Generate a complete PKCE pair (code verifier + code challenge).
 *
 * This is a convenience function that generates both values at once.
 * The code_verifier should be stored securely (e.g., in Redis) while
 * the code_challenge can be sent to external systems.
 *
 * @param length - Length of code verifier (default 64)
 * @returns Object containing both codeVerifier and codeChallenge
 * @throws {PkceError} If length is outside allowed range
 *
 * @example
 * ```typescript
 * const { codeVerifier, codeChallenge } = generatePkcePair();
 *
 * // Store verifier in Redis with TTL
 * await redis.set(`challenge:${codeChallenge}`, {
 *   verifier: codeVerifier,
 *   sessionId: session.id,
 *   expiresAt: Date.now() + 300000, // 5 minutes
 * });
 *
 * // Send challenge to webhook (never send verifier!)
 * await fetch(webhookUrl, {
 *   body: JSON.stringify({ code_challenge: codeChallenge, ... })
 * });
 * ```
 */
export function generatePkcePair(length: number = DEFAULT_CODE_VERIFIER_LENGTH): PkcePair {
  const codeVerifier = generateCodeVerifier(length);
  const codeChallenge = generateCodeChallenge(codeVerifier);
  return { codeVerifier, codeChallenge };
}

/**
 * Validate that a string is a valid code verifier.
 *
 * Checks that the string:
 * - Has a length between 43 and 128 characters
 * - Contains only unreserved characters per RFC 7636 (A-Z, a-z, 0-9, -, ., _, ~)
 *
 * @param value - The string to validate
 * @returns true if valid, false otherwise
 */
export function isValidCodeVerifier(value: string): boolean {
  if (value.length < MIN_CODE_VERIFIER_LENGTH || value.length > MAX_CODE_VERIFIER_LENGTH) {
    return false;
  }
  // RFC 7636: code-verifier = 43*128unreserved
  // unreserved = ALPHA / DIGIT / "-" / "." / "_" / "~"
  return /^[A-Za-z0-9\-._~]+$/.test(value);
}

/**
 * Validate that a string is a valid code challenge.
 *
 * A valid code challenge is a base64url-encoded SHA-256 hash (43 characters).
 *
 * @param value - The string to validate
 * @returns true if valid, false otherwise
 */
export function isValidCodeChallenge(value: string): boolean {
  // SHA-256 produces 32 bytes, base64url encoding produces 43 characters
  // (32 * 8 / 6 = 42.67, rounded up with no padding = 43)
  if (value.length !== 43) {
    return false;
  }
  // base64url characters only
  return /^[A-Za-z0-9\-_]+$/.test(value);
}
