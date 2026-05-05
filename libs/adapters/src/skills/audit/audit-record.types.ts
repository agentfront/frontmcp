// file: libs/adapters/src/skills/audit/audit-record.types.ts
//
// Tamper-evident, hash-chained audit record schema for skill action invocations.
// Each record signs the entire chain prefix (via prevHash) so any retroactive
// edit to a single record breaks the chain at that point. Designed to be
// scaling-aware: the `sequence` field is monotonically allocated by the
// underlying StorageAdapter (`incr`), which gives Redis/SQLite/Vercel KV a
// pod-safe linearization point.

/**
 * Phase of a skill action invocation that this record captures.
 *
 * - `authority-check-pass` is written immediately after the AuthorityGuard
 *   approves the call but before the upstream HTTP request fires. This means
 *   even denied-by-network or denied-by-budget invocations show up in the
 *   audit log alongside the inputHash that drove the decision.
 * - `authority-check-fail` is written when the AuthorityGuard denies the
 *   call. Most security-relevant events go here — without this phase,
 *   denied invocations would be unrecorded in the audit log.
 * - `http-call-success` is written after a successful upstream call, with
 *   the HTTP status and an outputHash derived from the response body.
 * - `http-call-failure` is written when the upstream call throws or returns
 *   a non-success envelope; status may be 0 if the request never reached the
 *   server (DNS, SSRF block, etc.).
 */
export type SkillAuditPhase =
  | 'authority-check-pass'
  | 'authority-check-fail'
  | 'http-call-success'
  | 'http-call-failure';

/**
 * Signature algorithm used to sign the audit record.
 *
 * - `HS256`: HMAC-SHA256 with a shared secret. Default for dev / single-pod
 *   in-memory deployments. Verifiers need access to the same secret, so this
 *   is unsuitable for handing off audit logs to external auditors.
 * - `RS256`: RSA-PKCS1-v1_5 with SHA-256. Pairs with the bundle-signing key
 *   registry (`SignatureKey.alg = 'RS256'`) so an admin configures one key
 *   and gets bundle + audit signing for free.
 *
 * NOTE: EdDSA is NOT included in this union — there is no Ed25519AuditSigner
 * implementation yet, and shipping a placeholder would let hosts opt into a
 * silently-broken signing path. When `@frontmcp/utils` gains Ed25519 support,
 * an `Ed25519AuditSigner` and the `'EdDSA'` literal can land together.
 */
export type SkillAuditSignatureAlg = 'HS256' | 'RS256';

/**
 * One signed entry in the skill action audit chain.
 *
 * The record is canonicalized (RFC 8785 JCS subset) before signing — the
 * resulting bytes are what `prevHash` points to in the next record. The
 * verifier walks the chain from the genesis record (prevHash = `'0'.repeat(64)`)
 * to the head, recomputing each prevHash and re-verifying each signature.
 *
 * NOTE: this record intentionally stores only HASHES of input/output bodies,
 * not the bodies themselves. Audit logs should not become a covert PII /
 * secret store. A `verbose` mode in `SkillAuditConfig` may attach a redacted
 * preview, but the canonical record schema is hash-only.
 */
export interface SkillAuditRecord {
  /** UUIDv4 — opaque, useful for correlating with downstream sinks. */
  id: string;
  /**
   * Monotonic chain index, allocated atomically from the storage adapter
   * (`StorageAdapter.incr('audit:skills:sequence')` in production). Genesis
   * record has sequence = 1.
   */
  sequence: number;
  /** ISO-8601 UTC timestamp of when this record was finalized. */
  timestamp: string;
  /** Authentication subject (e.g. JWT `sub`). `'anonymous'` when missing. */
  subject: string;
  /** Skill id from the bundle (e.g. `'billing'`). */
  skillId: string;
  /** Operation id within the skill (e.g. `'createInvoice'`). */
  actionId: string;
  /** Stable bundle id the action was resolved against. */
  bundleId: string;
  /** Bundle version pinned for this invocation (entry-pinned, not store-current). */
  bundleVersion: string;
  /** Phase being captured — see {@link SkillAuditPhase}. */
  phase: SkillAuditPhase;
  /** HTTP status, present for the http-call-* phases. */
  status?: number;
  /** sha256Hex(canonicalize(input)) — the input bytes never appear in the record. */
  inputHash: string;
  /** sha256Hex(canonicalize(output)) — only set on http-call-success when a body is present. */
  outputHash?: string;
  /** Redacted, truncated error description for http-call-failure. */
  errorMessage?: string;
  /**
   * sha256Hex of the canonicalized previous record (without its own signature).
   * The genesis record uses `'0'.repeat(64)`. Tamper detection works because
   * any retroactive edit changes the canonicalization of that record, which
   * changes the prevHash the next record expects, which breaks signature
   * verification on the next record.
   */
  prevHash: string;
  /**
   * Detached signature, base64url-encoded. The signed bytes are
   * `canonicalize(record without signature)` — see audit-chain.ts.
   */
  signature: string;
  /**
   * Stable id of the signing key. For RS256/EdDSA matches the
   * `SignatureKey.keyId` admins configure for bundle signing.
   */
  signatureKeyId: string;
  /** Algorithm used to sign — see {@link SkillAuditSignatureAlg}. */
  signatureAlg: SkillAuditSignatureAlg;
}

/**
 * Genesis prevHash — sha256 hex output is 64 chars; pre-genesis is "no prior
 * record", encoded as 64 zero hex chars so the field is always the same shape.
 */
export const SKILL_AUDIT_GENESIS_PREV_HASH = '0'.repeat(64);

/**
 * Storage key prefixes. Centralized so that the writer, store, and verifier
 * all agree on the layout.
 */
export const SKILL_AUDIT_KEYS = {
  /** Atomic chain head counter — incremented per append. */
  sequence: 'audit:skills:sequence',
  /** Per-record key. Use `SKILL_AUDIT_KEYS.record(seq)` to build. */
  record: (sequence: number): string => `audit:skills:records:${sequence}`,
} as const;
