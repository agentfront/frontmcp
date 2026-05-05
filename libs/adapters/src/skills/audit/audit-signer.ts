// file: libs/adapters/src/skills/audit/audit-signer.ts
//
// Pluggable signer for skill audit records. The default (`Hs256AuditSigner`)
// is appropriate for dev / single-pod stacks; production hosts should wire
// `Rs256AuditSigner` against the same RSA private key they use to sign
// bundles, so a single key registry governs both surfaces.
//
// The signer interface is intentionally synchronous so the writer's hot path
// stays single-await (`store.append`). All cryptography routes through
// `@frontmcp/utils` per CLAUDE.md.

import {
  base64urlDecode,
  base64urlEncode,
  hmacSha256,
  pemToPublicJwk,
  rsaSignBase64Url,
  rsaVerifySync,
  timingSafeEqual,
} from '@frontmcp/utils';

import { canonicalizeRecordForSigning, type AuditSignatureVerifier, type AuditTrustedKey } from './audit-chain';
import { type SkillAuditRecord, type SkillAuditSignatureAlg } from './audit-record.types';

/**
 * Result of a signing pass. Returned to the writer so it can stamp the
 * keyId/alg fields on the record alongside the signature itself.
 */
export interface SkillAuditSignResult {
  signature: string;
  keyId: string;
  alg: SkillAuditSignatureAlg;
}

/**
 * Stable interface for the writer to call. Each signer holds its own key
 * material (HMAC secret / RSA private JWK) — the writer never sees the
 * secret, only the public-facing keyId.
 */
export interface SkillAuditSigner {
  /** Sign the given record (sans signature fields) and return the envelope. */
  sign(record: Omit<SkillAuditRecord, 'signature' | 'signatureKeyId' | 'signatureAlg'>): SkillAuditSignResult;
  /** Public-facing key id — admins identify keys by this string. */
  getKeyId(): string;
  /** Algorithm this signer uses. */
  getAlg(): SkillAuditSignatureAlg;
}

/**
 * HMAC-SHA256 signer for dev / single-pod stacks. Uses a shared secret;
 * verification is symmetric, so this is unsuitable for handing audit logs
 * to external auditors who shouldn't be able to forge new entries.
 */
export class Hs256AuditSigner implements SkillAuditSigner {
  private readonly key: Uint8Array;
  private readonly keyId: string;

  /**
   * @param secret - HMAC secret. Strings are UTF-8 encoded; pass a
   *                 Uint8Array directly when you've derived the key (e.g.
   *                 from HKDF) and want to avoid the extra encode step.
   * @param keyId - Stable identifier (e.g. `'audit-dev-key'`) — surfaces in
   *                 the signed record's `signatureKeyId` field.
   */
  constructor(secret: string | Uint8Array, keyId: string) {
    if (!keyId) {
      throw new Error('Hs256AuditSigner: keyId must be a non-empty string');
    }
    if (typeof secret === 'string') {
      if (secret.length === 0) throw new Error('Hs256AuditSigner: secret must be non-empty');
      // TextEncoder.encode allocates a fresh buffer, so no extra copy needed.
      this.key = new TextEncoder().encode(secret);
    } else {
      if (secret.length === 0) throw new Error('Hs256AuditSigner: secret must be non-empty');
      // Defensive clone — caller may zeroize / mutate their buffer after
      // construction; the signer's key bytes must remain stable for the
      // process lifetime of the signer.
      this.key = new Uint8Array(secret);
    }
    this.keyId = keyId;
  }

  sign(record: Omit<SkillAuditRecord, 'signature' | 'signatureKeyId' | 'signatureAlg'>): SkillAuditSignResult {
    const canonicalBytes = new TextEncoder().encode(
      canonicalizeRecordForSigning({
        ...record,
        // Stub the signature fields to a deterministic shape so canonicalize
        // sees the exact same byte layout the verifier will reconstruct.
        signature: '',
        signatureKeyId: this.keyId,
        signatureAlg: 'HS256',
      }),
    );
    const mac = hmacSha256(this.key, canonicalBytes);
    return {
      signature: base64urlEncode(mac),
      keyId: this.keyId,
      alg: 'HS256',
    };
  }

  getKeyId(): string {
    return this.keyId;
  }

  getAlg(): SkillAuditSignatureAlg {
    return 'HS256';
  }
}

/**
 * RS256 signer that pairs with the bundle-signing key registry.
 *
 * The private key must be supplied as a JWK so the same persistence
 * surface (`@frontmcp/utils` KeyPersistence) that already stores asymmetric
 * keys for bundle signing can be reused. The matching public key — held by
 * verifiers — lives in the same `SignatureKey` allowlist hosts already
 * configure for `verifyBundleSignature`.
 *
 * Strict JWK validation: rejects EC/OKP/oct keys at construction time so a
 * misconfigured key surfaces immediately rather than at first sign() call.
 */
export class Rs256AuditSigner implements SkillAuditSigner {
  private readonly privateJwk: JsonWebKey;
  private readonly keyId: string;

  constructor(privateJwk: JsonWebKey, keyId: string) {
    if (!keyId) {
      throw new Error('Rs256AuditSigner: keyId must be a non-empty string');
    }
    if (!privateJwk || typeof privateJwk !== 'object') {
      throw new Error('Rs256AuditSigner: privateJwk must be a JWK object');
    }
    // Validate JWK shape — RSA private keys MUST carry kty='RSA' plus the
    // modulus `n`, public exponent `e`, and private exponent `d`. Without
    // these, sign() (or the underlying crypto.createPrivateKey JWK import)
    // would throw a confusing node:crypto error at runtime; rejecting here
    // keeps the failure mode at the configuration boundary.
    if (privateJwk.kty !== 'RSA') {
      throw new Error(`Rs256AuditSigner: privateJwk.kty must be "RSA", got "${String(privateJwk.kty)}"`);
    }
    if (!privateJwk.n || !privateJwk.e || !privateJwk.d) {
      throw new Error('Rs256AuditSigner: privateJwk must include `n`, `e`, and `d` (RSA private key)');
    }
    // Defensive shallow clone — RSA JWK fields are all string primitives, so
    // a spread is sufficient. Prevents the caller from mutating the JWK they
    // handed us (e.g. rotating `n`/`d` in place) after construction.
    this.privateJwk = { ...privateJwk };
    this.keyId = keyId;
  }

  sign(record: Omit<SkillAuditRecord, 'signature' | 'signatureKeyId' | 'signatureAlg'>): SkillAuditSignResult {
    const canonicalBytes = new TextEncoder().encode(
      canonicalizeRecordForSigning({
        ...record,
        signature: '',
        signatureKeyId: this.keyId,
        signatureAlg: 'RS256',
      }),
    );
    const signature = rsaSignBase64Url('RS256', canonicalBytes, this.privateJwk);
    return {
      signature,
      keyId: this.keyId,
      alg: 'RS256',
    };
  }

  getKeyId(): string {
    return this.keyId;
  }

  getAlg(): SkillAuditSignatureAlg {
    return 'RS256';
  }
}

// ─── Verifier (paired with signers above) ───────────────────────────────────

/**
 * Default verifier used by tests and stand-alone forensic tools. Production
 * hosts can wire their own verifier (e.g. backed by an HSM) by supplying a
 * different `AuditSignatureVerifier` to {@link verifyChain}.
 */
export const defaultAuditSignatureVerifier: AuditSignatureVerifier = ({
  alg,
  keyId,
  data,
  signatureBase64Url,
  trustedKeys,
}) => {
  const trusted = trustedKeys.find((k) => k.keyId === keyId && k.alg === alg);
  if (!trusted) return false;

  if (alg === 'HS256') {
    if (!trusted.secret) return false;
    const expected = hmacSha256(trusted.secret, data);
    let actual: Uint8Array;
    try {
      actual = base64urlDecode(signatureBase64Url);
    } catch {
      return false;
    }
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  }

  // RS256 — route through `@frontmcp/utils.rsaVerifySync` so all crypto
  // primitives stay in the single replaceable utility surface (per CLAUDE.md
  // — direct `node:crypto` usage outside utils is forbidden). Admins can
  // configure trust roots as either JWK or PEM; we normalize PEM → JWK
  // up-front so the verifier itself only has to handle one input shape.
  if (alg === 'RS256') {
    if (!trusted.publicKeyPem && !trusted.publicJwk) return false;
    let publicJwk: JsonWebKey;
    try {
      publicJwk = trusted.publicJwk ?? pemToPublicJwk(trusted.publicKeyPem as string);
    } catch {
      return false;
    }
    let sigBytes: Uint8Array;
    try {
      sigBytes = base64urlDecode(signatureBase64Url);
    } catch {
      return false;
    }
    return rsaVerifySync('RS256', data, publicJwk, sigBytes);
  }

  // Unknown alg -- the type already constrains this branch unreachable, but
  // we still return false so callers don't get hit with a thrown TypeError if
  // a new alg lands without a verifier update.
  const _exhaustive: never = alg;
  void _exhaustive;
  return false;
};

export type { AuditTrustedKey };
