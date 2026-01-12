/**
 * Generic HMAC Signing Utilities
 *
 * Provides HMAC-SHA256 signing and verification for any JSON-serializable data.
 * Protects against data tampering when stored in external systems.
 *
 * @example
 * ```typescript
 * import { signData, verifyData } from '@frontmcp/utils';
 *
 * // Sign any data
 * const signed = signData({ userId: '123', role: 'admin' }, { secret: 'my-secret' });
 *
 * // Verify and extract
 * const data = verifyData(signed, { secret: 'my-secret' });
 * if (data) {
 *   console.log(data.userId); // '123'
 * }
 * ```
 */

import { hmacSha256 } from './index';
import { base64urlEncode, base64urlDecode } from './index';
import { timingSafeEqual } from './index';

/**
 * Signed data wrapper structure.
 * Contains the data and its HMAC signature.
 */
export interface SignedData<T> {
  /** The signed data */
  data: T;
  /** HMAC-SHA256 signature in base64url format */
  sig: string;
  /** Signature version for future algorithm changes */
  v: 1;
}

/**
 * Configuration for HMAC signing operations.
 */
export interface HmacSigningConfig {
  /**
   * The secret key used for HMAC signing.
   * Should be at least 32 bytes for security.
   */
  secret: string;
}

/**
 * Compute HMAC-SHA256 signature for string data.
 */
function computeSignature(data: string, secret: string): string {
  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(secret);
  const dataBytes = encoder.encode(data);
  const hmac = hmacSha256(keyBytes, dataBytes);
  return base64urlEncode(hmac);
}

/**
 * Sign data with HMAC-SHA256.
 *
 * Creates a tamper-evident wrapper around the data.
 * Any modification to the data will invalidate the signature.
 *
 * @param data - The data to sign (must be JSON-serializable)
 * @param config - Signing configuration with secret
 * @returns JSON string containing signed data
 *
 * @example
 * ```typescript
 * const signed = signData({ key: 'value' }, { secret: 'my-secret' });
 * await redis.set('mykey', signed);
 * ```
 */
export function signData<T>(data: T, config: HmacSigningConfig): string {
  const jsonData = JSON.stringify(data);
  const sig = computeSignature(jsonData, config.secret);

  const signed: SignedData<T> = {
    data,
    sig,
    v: 1,
  };

  return JSON.stringify(signed);
}

/**
 * Verify and extract signed data.
 *
 * Validates the HMAC signature and returns the data if valid.
 * Returns null if the signature is invalid or the data is corrupted.
 *
 * @param signedJson - JSON string from signData()
 * @param config - Signing configuration with secret
 * @returns The verified data or null if invalid
 *
 * @example
 * ```typescript
 * const raw = await redis.get('mykey');
 * const data = verifyData<MyType>(raw, { secret: 'my-secret' });
 * if (!data) {
 *   // Data was tampered with or corrupted
 * }
 * ```
 */
export function verifyData<T>(signedJson: string, config: HmacSigningConfig): T | null {
  try {
    const parsed = JSON.parse(signedJson) as unknown;

    // Check if this is signed data (has 'sig' field)
    if (!parsed || typeof parsed !== 'object' || !('sig' in parsed)) {
      return null;
    }

    const signed = parsed as SignedData<T>;

    // Verify version
    if (signed.v !== 1) {
      return null;
    }

    // Recompute signature from data
    const jsonData = JSON.stringify(signed.data);
    const expectedSig = computeSignature(jsonData, config.secret);

    // Use timing-safe comparison to prevent timing attacks
    const sigBytes = base64urlDecode(signed.sig);
    const expectedBytes = base64urlDecode(expectedSig);

    if (sigBytes.length !== expectedBytes.length) {
      return null;
    }

    if (!timingSafeEqual(sigBytes, expectedBytes)) {
      return null;
    }

    return signed.data;
  } catch {
    return null;
  }
}

/**
 * Check if a stored value is signed data.
 * Useful for migrating from unsigned to signed data.
 *
 * @param json - Raw JSON string from storage
 * @returns true if the data appears to be signed
 */
export function isSignedData(json: string): boolean {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' && 'sig' in parsed && 'v' in parsed;
  } catch {
    return false;
  }
}

/**
 * Verify or parse data, supporting both signed and unsigned formats.
 * Useful for backwards compatibility during migration.
 *
 * @param json - Raw JSON string from storage
 * @param config - Signing configuration with secret
 * @returns The data (verified if signed, parsed if unsigned) or null
 */
export function verifyOrParseData<T>(json: string, config: HmacSigningConfig): T | null {
  if (isSignedData(json)) {
    return verifyData<T>(json, config);
  }

  // Legacy unsigned data - parse without verification
  // IMPORTANT: Caller should validate the result
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
