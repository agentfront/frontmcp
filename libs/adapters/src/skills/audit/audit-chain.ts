// file: libs/adapters/src/skills/audit/audit-chain.ts
//
// Pure functions for building and verifying the hash-chained, signed audit
// log. Kept side-effect-free so the verifier can run anywhere — including a
// stand-alone forensic tool that only has the records and a public key set.
//
// The canonicalization here REUSES the JCS routine the bundle-signature
// module ships, so a single implementation governs both bundle and audit
// signing. Drift between the two would break verification, so we import
// rather than fork.

import { sha256Hex } from '@frontmcp/utils';

import { canonicalize } from '../security/bundle-signature';
import {
  SKILL_AUDIT_GENESIS_PREV_HASH,
  type SkillAuditPhase,
  type SkillAuditRecord,
  type SkillAuditSignatureAlg,
} from './audit-record.types';

/**
 * Trusted signing key used by the verifier. Holds either an HMAC secret
 * (HS256) or an RSA/Ed25519 public JWK (RS256/EdDSA). Verifier callers
 * provide the full set; per-record `signatureKeyId` selects which key to
 * use, so a key rotation that changes only the active signer doesn't
 * invalidate older records signed by an older key.
 */
export interface AuditTrustedKey {
  keyId: string;
  alg: SkillAuditSignatureAlg;
  /** HMAC secret bytes (HS256) — required when alg is HS256. */
  secret?: Uint8Array;
  /** Public JWK (RS256 / EdDSA) — required when alg is RS256 or EdDSA. */
  publicJwk?: JsonWebKey;
  /** Public PEM (RS256 / EdDSA) — alternative to JWK; used when JWK is unavailable. */
  publicKeyPem?: string;
}

/**
 * Result of {@link verifyChain}. On success, the chain is fully linked and
 * every signature checks out. On failure, `breakAt` is the sequence number
 * (or array index when records lack sequences) of the first record that
 * fails — useful for narrowing down which write was tampered with.
 */
export type AuditChainVerifyResult = { ok: true; verified: number } | { ok: false; breakAt: number; reason: string };

/**
 * Synchronous signature verifier. The audit signer interface is sync (so the
 * writer can run without an extra await per record); the verifier matches.
 *
 * Implementations live in `audit-signer.ts` (HS256 + RS256/EdDSA via Node's
 * `crypto.verify`). Tests can pass a stub.
 */
export type AuditSignatureVerifier = (input: {
  alg: SkillAuditSignatureAlg;
  keyId: string;
  data: Uint8Array;
  signatureBase64Url: string;
  trustedKeys: AuditTrustedKey[];
}) => boolean;

/**
 * Strip the `signature` field from a record and return the JCS-canonicalized
 * bytes that are signed (and hashed for prevHash). Exported so the writer can
 * reuse it when computing the prevHash for the next record.
 */
export function canonicalizeRecordForSigning(record: SkillAuditRecord): string {
  const { signature: _drop, ...rest } = record;
  void _drop;
  return canonicalize(rest);
}

/**
 * Compute the prevHash that the next record after `prev` should carry. When
 * `prev` is undefined (genesis), returns the all-zeros sentinel.
 */
export function nextPrevHash(prev: SkillAuditRecord | undefined): string {
  if (!prev) return SKILL_AUDIT_GENESIS_PREV_HASH;
  return sha256Hex(canonicalizeRecordForSigning(prev));
}

/**
 * Fields the writer fills in. Everything else (prevHash, signature*) is
 * derived inside the writer pipeline.
 */
export type SkillAuditPartialRecord = Omit<
  SkillAuditRecord,
  'prevHash' | 'signature' | 'signatureKeyId' | 'signatureAlg'
>;

/**
 * Link a partial record to a chain by stamping its prevHash from `prev`.
 * The signature/signatureKeyId/signatureAlg are NOT filled here — that's
 * the signer's job, called separately so that a missing signer surfaces as
 * a runtime configuration error rather than a silently-unsigned record.
 */
export function linkRecord(
  prev: SkillAuditRecord | undefined,
  partial: SkillAuditPartialRecord,
): Omit<SkillAuditRecord, 'signature' | 'signatureKeyId' | 'signatureAlg'> {
  return {
    ...partial,
    prevHash: nextPrevHash(prev),
  };
}

/**
 * Walk the chain in order, recomputing each prevHash and verifying each
 * signature. Returns the first break or `{ ok: true }` on a clean run.
 *
 * The verifier is permissive about empty input (vacuously OK) and strict
 * about ordering — records must already be sorted by `sequence` ascending.
 * Production stores sort on read; tests should pass already-sorted arrays.
 */
export function verifyChain(
  records: ReadonlyArray<SkillAuditRecord>,
  trustedKeys: ReadonlyArray<AuditTrustedKey>,
  verifier: AuditSignatureVerifier,
): AuditChainVerifyResult {
  if (records.length === 0) {
    return { ok: true, verified: 0 };
  }

  let prev: SkillAuditRecord | undefined;
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (!rec) {
      return { ok: false, breakAt: i, reason: 'record at index is null/undefined' };
    }

    // 1. Sequence monotonicity (catches reordering / dropped records).
    if (prev && rec.sequence !== prev.sequence + 1) {
      return {
        ok: false,
        breakAt: rec.sequence,
        reason: `sequence gap: expected ${prev.sequence + 1}, got ${rec.sequence}`,
      };
    }

    // 2. prevHash continuity.
    const expectedPrev = nextPrevHash(prev);
    if (rec.prevHash !== expectedPrev) {
      return {
        ok: false,
        breakAt: rec.sequence,
        reason: `prevHash mismatch at sequence ${rec.sequence}: expected ${expectedPrev.slice(0, 12)}.. got ${rec.prevHash.slice(0, 12)}..`,
      };
    }

    // 3. Signature.
    const canonicalBytes = new TextEncoder().encode(canonicalizeRecordForSigning(rec));
    const ok = verifier({
      alg: rec.signatureAlg,
      keyId: rec.signatureKeyId,
      data: canonicalBytes,
      signatureBase64Url: rec.signature,
      trustedKeys: [...trustedKeys],
    });
    if (!ok) {
      return {
        ok: false,
        breakAt: rec.sequence,
        reason: `signature verification failed at sequence ${rec.sequence} (keyId="${rec.signatureKeyId}", alg=${rec.signatureAlg})`,
      };
    }

    prev = rec;
  }

  return { ok: true, verified: records.length };
}

/** Re-exports for ergonomic external import. */
export type { SkillAuditPhase, SkillAuditRecord };
