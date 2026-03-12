/**
 * JWT algorithm helpers.
 *
 * This module is intentionally dependency-free (no Node-only imports) so it can be safely re-used
 * from both browser-compatible and Node-only code.
 */

const JWT_ALG_TO_NODE_DIGEST: Record<string, string> = {
  RS256: 'RSA-SHA256',
  RS384: 'RSA-SHA384',
  RS512: 'RSA-SHA512',
  // For RSA-PSS, Node's crypto.sign/verify uses the digest algorithm + explicit PSS padding options.
  PS256: 'RSA-SHA256',
  PS384: 'RSA-SHA384',
  PS512: 'RSA-SHA512',
};

export function jwtAlgToNodeAlg(jwtAlg: string): string {
  const nodeAlg = JWT_ALG_TO_NODE_DIGEST[jwtAlg];
  if (!nodeAlg) {
    throw new Error(`Unsupported JWT algorithm: ${jwtAlg}`);
  }
  return nodeAlg;
}

export function isRsaPssAlg(jwtAlg: string): boolean {
  return jwtAlg.startsWith('PS');
}

// ============================================================================
// WebCrypto algorithm mapping (browser-compatible)
// ============================================================================

const JWT_ALG_TO_WEB_CRYPTO: Record<string, string> = {
  RS256: 'SHA-256',
  RS384: 'SHA-384',
  RS512: 'SHA-512',
  PS256: 'SHA-256',
  PS384: 'SHA-384',
  PS512: 'SHA-512',
};

/**
 * Map a JWT algorithm to a WebCrypto hash algorithm name.
 * Used for `crypto.subtle.importKey()` and `crypto.subtle.verify()`.
 */
export function jwtAlgToWebCryptoAlg(jwtAlg: string): string {
  const webAlg = JWT_ALG_TO_WEB_CRYPTO[jwtAlg];
  if (!webAlg) {
    throw new Error(`Unsupported JWT algorithm for WebCrypto: ${jwtAlg}`);
  }
  return webAlg;
}
