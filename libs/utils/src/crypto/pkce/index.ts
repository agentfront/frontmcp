/**
 * PKCE (Proof Key for Code Exchange) utilities
 *
 * Implements RFC 7636 for secure authorization flows.
 * Used for webhook callbacks, OAuth flows, and tool approval.
 *
 * @module @frontmcp/utils/pkce
 */

export {
  // Constants
  MIN_CODE_VERIFIER_LENGTH,
  MAX_CODE_VERIFIER_LENGTH,
  DEFAULT_CODE_VERIFIER_LENGTH,
  // Error
  PkceError,
  // Functions
  generateCodeVerifier,
  generateCodeChallenge,
  verifyCodeChallenge,
  generatePkcePair,
  isValidCodeVerifier,
  isValidCodeChallenge,
  // Types
  type PkcePair,
} from './pkce';
