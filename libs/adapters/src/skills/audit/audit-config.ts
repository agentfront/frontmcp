// file: libs/adapters/src/skills/audit/audit-config.ts
//
// Public config surface for skill audit logging. Wired into the SDK's
// `skillsConfig.audit` option (see libs/sdk/src/common/types/options/skills-http).
// Defaults are conservative: audit is OFF unless explicitly enabled.

import type { Token } from '@frontmcp/di';

import type { SkillAuditSigner } from './audit-signer';
import type { SkillAuditStore } from './audit-store';
import type { SkillAuditWriter } from './audit-writer';

/**
 * How `subject` (typically a JWT `sub`) is persisted in the audit record.
 *
 * - `'plain'` (legacy default): the raw subject is written verbatim — useful
 *   for forensic correlation, but the record then contains PII that GDPR
 *   right-to-be-forgotten cannot delete without breaking the prevHash chain.
 * - `'hash'` (recommended default in v1.2+): the subject is replaced with a
 *   keyed HMAC-SHA256 of the value (keyed by the audit secret material). The
 *   hash is deterministic per-secret so records for the same user can still
 *   be joined without the verifier needing the user identity. Reverses to
 *   nothing — no rainbow / no forensic recovery — so the host MUST keep its
 *   own subject->hash map externally if reverse lookup is ever needed.
 * - `'omit'`: subject is replaced with a constant `'redacted'`. Use when even
 *   joining records by user is unwanted (e.g. handed off to an external
 *   auditor who only needs to validate signatures + hash continuity).
 */
export type SkillAuditSubjectMode = 'plain' | 'hash' | 'omit';

/**
 * Configuration for the skill action audit log.
 *
 * The `enabled` flag is the master switch. When enabled, callers SHOULD
 * supply both a `signer` and a `store`; when omitted, the SDK falls back to
 * sensible defaults (in-memory store, HS256 signer with a randomly-generated
 * secret) that are appropriate ONLY for development. Production hosts must
 * wire their own — defaults are flagged in logs.
 *
 * @remarks Multi-pod / cross-process safety
 * The current implementation is **single-writer** (single-pod) safe. The
 * writer caches the chain tail per-process so concurrent writers across
 * multiple pods can produce records whose `prevHash` references a stale
 * tail, which the verifier then reports as a chain break. Operators who run
 * multiple replicas behind a load balancer should either:
 *   - run a single dedicated audit pod, or
 *   - configure leader election so only one pod appends at a time, or
 *   - accept that concurrent writers may produce verifier breaks and rely on
 *     external head-pinning for tamper-evidence.
 * v1.3.0 will introduce a CAS-based chain-head primitive that fuses
 * `incr(seq) → set(record:N IF NX) → return tail-bytes` into a single
 * Lua/EVAL atomic — see `// TODO(v1.3.0)` in audit-store.ts.
 */
export interface SkillAuditConfig {
  /**
   * Master switch. Default: false (opt-in feature, no overhead when disabled).
   */
  enabled?: boolean;

  /**
   * Pluggable signer. When omitted, a process-local HS256 signer is created
   * with a randomly-generated 32-byte secret. The secret is never logged but
   * IS process-local — restarting the process resets it, which means
   * pre-restart records can no longer be verified. Production hosts MUST
   * supply an explicit signer.
   */
  signer?: SkillAuditSigner;

  /**
   * Pluggable store. When omitted, an in-memory store is used. Suitable for
   * dev / single-pod deployments only. Production hosts should wire a
   * `StorageAdapterAuditStore` against their Redis/SQLite/Vercel KV adapter.
   */
  store?: SkillAuditStore;

  /**
   * How the `subject` field (typically JWT `sub`) is persisted. Default:
   * `'hash'` — deterministic HMAC per audit-secret so records can be joined
   * without surfacing PII in the persisted log. See {@link SkillAuditSubjectMode}.
   */
  subjectMode?: SkillAuditSubjectMode;

  /**
   * Optional periodic head-anchor interval (milliseconds). When set, the
   * writer occasionally writes `{ tail: { sequence, hash, timestamp } }` to
   * an external immutable store (when one is configured at the host level)
   * so the verifier can detect tail truncation that resets the sequence
   * counter. Out-of-scope for v1.2.0; reserved for v1.3.0.
   *
   * @defaultValue undefined (no head anchoring; tail truncation is NOT
   * detectable by the bundled verifier — see `verifyChain` JSDoc).
   */
  headAnchorIntervalMs?: number;
}

/**
 * DI token for the audit writer service. Resolved lazily by the
 * ExecuteActionTool via `tryGet` so an unconfigured server is a no-op.
 */
export const SkillAuditWriterToken: Token<SkillAuditWriter> = Symbol.for(
  'frontmcp:SKILL_AUDIT_WRITER',
) as Token<SkillAuditWriter>;
