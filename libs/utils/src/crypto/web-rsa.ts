import { isRsaPssAlg, jwtAlgToWebCryptoAlg } from './jwt-alg';

/**
 * Verify an RSA signature using WebCrypto.
 *
 * Supports RS256/RS384/RS512 (RSASSA-PKCS1-v1_5) and PS256/PS384/PS512 (RSA-PSS).
 * Works in both browsers and Node.js environments that provide `crypto.subtle`.
 *
 * @param jwtAlg - JWT algorithm identifier (e.g. 'RS256', 'PS256')
 * @param data - The signed data (e.g. `headerB64.payloadB64`)
 * @param publicJwk - Public key in JWK format
 * @param signature - The signature bytes
 * @returns true if the signature is valid
 */
export async function rsaVerifyBrowser(
  jwtAlg: string,
  data: Uint8Array,
  publicJwk: JsonWebKey,
  signature: Uint8Array,
): Promise<boolean> {
  if (typeof globalThis.crypto?.subtle === 'undefined') {
    throw new Error('WebCrypto API (crypto.subtle) is not available in this environment');
  }

  const webAlg = jwtAlgToWebCryptoAlg(jwtAlg);
  const isPss = isRsaPssAlg(jwtAlg);

  const algorithm: RsaHashedImportParams = {
    name: isPss ? 'RSA-PSS' : 'RSASSA-PKCS1-v1_5',
    hash: { name: webAlg },
  };

  const key = await globalThis.crypto.subtle.importKey('jwk', publicJwk, algorithm, false, ['verify']);

  const verifyAlgorithm: AlgorithmIdentifier | RsaPssParams = isPss
    ? { name: 'RSA-PSS', saltLength: getSaltLength(jwtAlg) }
    : { name: 'RSASSA-PKCS1-v1_5' };

  // Create new Uint8Array views to ensure standard ArrayBuffer backing
  const sigBuf = new Uint8Array(signature).buffer as ArrayBuffer;
  const dataBuf = new Uint8Array(data).buffer as ArrayBuffer;
  return globalThis.crypto.subtle.verify(verifyAlgorithm, key, sigBuf, dataBuf);
}

/**
 * Get the salt length for RSA-PSS based on the JWT algorithm.
 */
function getSaltLength(jwtAlg: string): number {
  switch (jwtAlg) {
    case 'PS256':
      return 32; // SHA-256 digest length
    case 'PS384':
      return 48; // SHA-384 digest length
    case 'PS512':
      return 64; // SHA-512 digest length
    default:
      return 32;
  }
}
