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

// All crypto primitives route through `@frontmcp/utils` per CLAUDE.md.
// `pemToPublicJwk` normalizes the trust list (admins configure PEMs);
// `rsaVerifySync` handles RS256 + EdDSA verification.
import { base64urlDecode, pemToPublicJwk, rsaVerifySync, sha256Hex } from '@frontmcp/utils';

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
  if (reason.includes('not valid base64url')) return 'malformed_signature';
  if (reason.includes('signature verify threw')) return 'verify_threw';
  if (reason.includes('signature verification failed')) return 'verify_failed';
  return 'other';
}

/**
 * The longest text `canonicalize` writes. A value parsed from YAML can repeat one object through aliases, and
 * each repeat is written out in full, so a small document can stand for text far longer than itself.
 */
export const CANONICAL_MAX_LENGTH = 32 * 1024 * 1024;

/**
 * Stable JSON canonicalization for signing: sorted object keys, no whitespace.
 * Matches RFC 8785 (JCS) for our subset (no floats with weird precision).
 * Throws when the text would pass {@link CANONICAL_MAX_LENGTH} characters.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  const parts: string[] = [];
  writeCanonical(value, parts, { remaining: CANONICAL_MAX_LENGTH }, false);
  return parts.join('');
}

/** Append the canonical text of `value` to `parts`; a missing value reads `undefined` in an object, nothing in an array. */
function writeCanonical(value: unknown, parts: string[], budget: { remaining: number }, inObject: boolean): void {
  if (value === null || typeof value !== 'object') {
    append(parts, JSON.stringify(value) ?? (inObject ? 'undefined' : ''), budget);
    return;
  }
  if (Array.isArray(value)) {
    append(parts, '[', budget);
    for (let index = 0; index < value.length; index++) {
      if (index > 0) append(parts, ',', budget);
      writeCanonical(value[index], parts, budget, false);
    }
    append(parts, ']', budget);
    return;
  }
  const obj = value as Record<string, unknown>;
  append(parts, '{', budget);
  Object.keys(obj)
    .sort()
    .forEach((key, index) => {
      append(parts, `${index > 0 ? ',' : ''}${JSON.stringify(key)}:`, budget);
      writeCanonical(obj[key], parts, budget, true);
    });
  append(parts, '}', budget);
}

/** Add `text` to `parts`, and throw once the texts added pass what `budget` allows. */
function append(parts: string[], text: string, budget: { remaining: number }): void {
  budget.remaining -= text.length;
  if (budget.remaining < 0) {
    throw new Error(
      `value is longer than ${CANONICAL_MAX_LENGTH} characters when canonicalized; ` +
        'a value that repeats through YAML aliases is written out once per repeat, so send one with fewer repeats',
    );
  }
  parts.push(text);
}

/** sha256 hex digest of the canonical bytes of an object (minus integrity). */
export function bundleDigest(bundle: ResolvedBundle): string {
  const { integrity: _drop, ...rest } = bundle;
  void _drop;
  return sha256Hex(canonicalize(rest));
}

/**
 * Decode a base64url-encoded signature into raw bytes. Routed through
 * `@frontmcp/utils.base64urlDecode` so the parsing surface is centralized
 * (and security-testable independently from the verifier glue).
 */
function decodeSignatureBytes(signatureBase64Url: string): Uint8Array | undefined {
  try {
    return base64urlDecode(signatureBase64Url);
  } catch {
    return undefined;
  }
}

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

  let expectedDigest: string;
  try {
    expectedDigest = bundleDigest(bundle);
  } catch (e) {
    return fail(`bundle could not be canonicalized: ${(e as Error).message}`);
  }
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

  let publicJwk: JsonWebKey;
  try {
    publicJwk = pemToPublicJwk(trusted.publicKeyPem);
  } catch (e) {
    return fail(`failed to parse public key for "${keyId}": ${(e as Error).message}`);
  }

  const sigBytes = decodeSignatureBytes(signature);
  if (!sigBytes) {
    return fail('signature is not valid base64url');
  }

  // Reconstruct canonical bytes that were signed.
  const { integrity: _drop, ...rest } = bundle;
  void _drop;
  const canonicalBytes = new TextEncoder().encode(canonicalize(rest));

  // `rsaVerifySync` handles RS256, RSA-PSS, and EdDSA in a single Node-only
  // utility — and never throws (returns `false` on any internal failure)
  // so we don't need a try/catch at the call site.
  const verified = rsaVerifySync(alg, canonicalBytes, publicJwk, sigBytes);

  if (!verified) {
    return fail('signature verification failed');
  }

  verificationsCounter?.inc(1, { status: 'ok' });
  return { ok: true, keyId, alg };
}
