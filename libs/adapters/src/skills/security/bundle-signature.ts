// file: plugins/plugin-skilled-openapi/src/security/bundle-signature.ts
//
// Bundle signature verification, modeled on OPA's signed-bundle pattern:
//   - The bundle ships an `integrity` envelope with `alg`, `keyId`, `digest`,
//     `signature`. The digest is the sha256 of the canonical bundle bytes
//     (the bundle JSON minus the `integrity` field, JSON-canonicalized).
//   - Plugin verifies (a) the digest matches the actual canonical bytes and
//     (b) the signature is valid for that digest under a trusted public key
//     identified by `keyId`.
//
// On failure the plugin REJECTS the bundle and keeps the previous one — never
// half-apply (per OPA's lesson). All failure paths surface a structured reason.

// Per CLAUDE.md: hashing routes through `@frontmcp/utils` for cross-platform
// behavior parity. createPublicKey / verify stay on node:crypto because the
// utils package does not currently expose asymmetric-signature verification
// helpers; if/when it does, swap those over too.
import { createPublicKey, verify as nodeVerify } from 'node:crypto';

import { sha256Hex } from '@frontmcp/utils';

import type { BundleIntegrity, ResolvedBundle } from '../bundle/bundle.types';
import type { SignatureKey } from '../source-options';

export type SignatureVerifyResult =
  | { ok: true; keyId: string; alg: BundleIntegrity['alg'] }
  | { ok: false; reason: string };

/**
 * Minimal telemetry surface for signature verification failures. Structurally
 * compatible with `@frontmcp/observability`'s `TelemetryAccessor` so callers
 * can pass that directly, while keeping this module dependency-free.
 */
export interface SignatureVerifyCounter {
  inc(by?: number, attributes?: Record<string, string>): void;
}
export interface SignatureVerifyTelemetry {
  createCounter(name: string, description?: string): SignatureVerifyCounter;
}

/**
 * Map a free-text `reason` (returned in the result envelope) to a low-cardinality
 * label suitable for a counter attribute. Counters MUST NOT include unbounded
 * strings (digest hex, key IDs from untrusted sources) as labels.
 */
function classifyReason(reason: string): string {
  if (reason.includes('missing integrity')) return 'missing_integrity';
  if (reason.includes('digest mismatch')) return 'digest_mismatch';
  if (reason.includes('unknown signing keyId')) return 'unknown_key_id';
  if (reason.includes('alg=')) return 'alg_mismatch';
  if (reason.includes('parse public key')) return 'malformed_public_key';
  if (reason.includes('signature verify threw')) return 'verify_threw';
  if (reason.includes('signature verification failed')) return 'verify_failed';
  return 'other';
}

/**
 * Stable JSON canonicalization for signing: sorted object keys, no whitespace.
 * Matches RFC 8785 (JCS) for our subset (no floats with weird precision).
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`;
}

/** sha256 hex digest of the canonical bytes of an object (minus integrity). */
export function bundleDigest(bundle: ResolvedBundle): string {
  const { integrity: _drop, ...rest } = bundle;
  void _drop;
  return sha256Hex(canonicalize(rest));
}

function base64urlToBuffer(b64url: string): Buffer {
  // jose-style base64url → buffer
  const pad = b64url.length % 4 === 0 ? '' : '='.repeat(4 - (b64url.length % 4));
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

const ALG_TO_NODE: Record<BundleIntegrity['alg'], { hash: string; padding?: number }> = {
  RS256: { hash: 'sha256' },
  EdDSA: { hash: '' }, // Ed25519: digest is internal to the algorithm
};

/**
 * Verify an integrity envelope against a set of trusted keys.
 *
 * Verification flow:
 *   1. Re-compute the canonical digest of the bundle (excluding `integrity`).
 *   2. Reject if the computed digest does not match the envelope's `digest`.
 *   3. Look up the trusted key by `keyId`. Reject if unknown.
 *   4. Reject if the key's `alg` does not match the envelope's `alg`.
 *   5. Verify the signature over the canonical bytes (NOT the digest hex)
 *      using the public key.
 *
 * Returns a structured ok/reason envelope. Callers MUST refuse to apply the
 * bundle on `ok: false`.
 */
export function verifyBundleSignature(
  bundle: ResolvedBundle,
  trustedKeys: SignatureKey[],
  telemetry?: SignatureVerifyTelemetry,
): SignatureVerifyResult {
  // Lazily resolve counters so verify-paths without telemetry skip the
  // lookup entirely. Two counters are emitted to enable failure-rate math
  // without a second source-of-truth:
  //   1) `frontmcp_skills_signature_verifications_total{status}` — every call
  //   2) `frontmcp_skills_signature_failures_total{reason}` — failures only
  // Operators can compute failure rate as `failures / verifications` from a
  // single timeseries source.
  const failuresCounter = telemetry?.createCounter(
    'frontmcp_skills_signature_failures_total',
    'Number of bundle signature verification failures, partitioned by reason.',
  );
  const verificationsCounter = telemetry?.createCounter(
    'frontmcp_skills_signature_verifications_total',
    'Number of bundle signature verification attempts, partitioned by status (ok|error).',
  );
  const fail = (reason: string): SignatureVerifyResult => {
    failuresCounter?.inc(1, { reason: classifyReason(reason) });
    verificationsCounter?.inc(1, { status: 'error' });
    return { ok: false, reason };
  };

  if (!bundle.integrity) {
    return fail('bundle missing integrity envelope');
  }
  const { alg, keyId, signature, digest } = bundle.integrity;

  const expectedDigest = bundleDigest(bundle);
  if (digest.toLowerCase() !== expectedDigest.toLowerCase()) {
    return fail(`digest mismatch (envelope=${digest.slice(0, 12)}.. computed=${expectedDigest.slice(0, 12)}..)`);
  }

  const trusted = trustedKeys.find((k) => k.keyId === keyId);
  if (!trusted) {
    return fail(`unknown signing keyId "${keyId}" — not in trustedKeys allowlist`);
  }
  if (trusted.alg !== alg) {
    return fail(`key "${keyId}" alg=${trusted.alg} but envelope alg=${alg}`);
  }

  let publicKey;
  try {
    publicKey = createPublicKey({ key: trusted.publicKeyPem, format: 'pem' });
  } catch (e) {
    return fail(`failed to parse public key for "${keyId}": ${(e as Error).message}`);
  }

  const sigBuf = base64urlToBuffer(signature);
  const { hash } = ALG_TO_NODE[alg];

  // Reconstruct canonical bytes that were signed.
  const { integrity: _drop, ...rest } = bundle;
  void _drop;
  const canonicalBytes = Buffer.from(canonicalize(rest), 'utf8');

  let verified: boolean;
  try {
    if (alg === 'RS256') {
      verified = nodeVerify(hash, canonicalBytes, publicKey, sigBuf);
    } else {
      // EdDSA / Ed25519: pass null algorithm name to node verify
      verified = nodeVerify(null, canonicalBytes, publicKey, sigBuf);
    }
  } catch (e) {
    return fail(`signature verify threw: ${(e as Error).message}`);
  }

  if (!verified) {
    return fail('signature verification failed');
  }

  verificationsCounter?.inc(1, { status: 'ok' });
  return { ok: true, keyId, alg };
}
