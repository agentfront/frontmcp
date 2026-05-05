// file: libs/adapters/src/skills/audit/audit-writer.ts
//
// High-level service that the ExecuteActionTool calls into at three points
// of every skill action invocation. The writer:
//   - Builds the typed record (hash inputs/outputs, capture subject).
//   - Serializes per-process appends through a Promise queue so two
//     concurrent invocations can't both read tail() and then race on append.
//   - NEVER throws into the tool flow. Audit failures must not break the
//     user's request — we log a warning and bump a failure counter.
//
// The tool MUST NOT await the writer's promise: each `write*` returns a
// promise that completes after the chained store work is finished, but the
// tool detaches it (`void writer.writeXxx(...)`) so a slow audit backend
// never blocks the user's request. The promise return is preserved so
// tests and `flush()` callers can wait when they want to.
//
// Multi-pod / cross-process safety
// --------------------------------
// v1.2.0 is **single-writer** safe by design. The writer always re-reads the
// chain tail from the store before each append (no per-process tail cache),
// which means a second pod against the same backing store doesn't link
// against a stale tail it never observed. But the read-tail/incr-seq/append
// triple is still NOT atomic across pods — two writers can read the same
// tail, both call `incr`, and produce records `prevHash`-linked to the same
// older record. The verifier then reports a chain break at the boundary.
// Operators running multiple replicas behind a load balancer should:
//   - run a single dedicated audit pod, OR
//   - configure leader election so only one pod appends at a time, OR
//   - accept that concurrent writers may produce verifier breaks and rely
//     on external head-pinning for tamper-evidence.
// v1.3.0 will introduce a CAS-based chain-head primitive that fuses
// incr+set+tail-read into a single atomic — TODO(v1.3.0).

import { hmacSha256, randomUUID, sha256Hex } from '@frontmcp/utils';

import { canonicalize } from '../security/bundle-signature';
import { linkRecord } from './audit-chain';
import type { SkillAuditSubjectMode } from './audit-config';
import { SKILL_AUDIT_GENESIS_PREV_HASH, type SkillAuditPhase, type SkillAuditRecord } from './audit-record.types';
import type { SkillAuditSigner } from './audit-signer';
import type { SkillAuditStore } from './audit-store';

/**
 * Minimal logger surface — matches `FrontMcpLogger` but we don't import it
 * here to keep the audit module shippable without an SDK dependency.
 */
export interface SkillAuditLogger {
  warn(...args: unknown[]): void;
  debug?(...args: unknown[]): void;
}

/**
 * Optional metrics counter. When wired (e.g. by the telemetry agent) a
 * failed audit write increments
 * `frontmcp_skills_audit_write_failures_total{reason}` and a dropped record
 * (queue overflow) increments
 * `frontmcp_skills_audit_dropped_total{reason}`. Left as a callback so the
 * audit module doesn't take a metrics dependency.
 */
export interface SkillAuditMetrics {
  incrementWriteFailure(reason: 'sign' | 'append' | 'unexpected'): void;
  incrementDropped?(reason: 'queue-overflow' | 'background-failure'): void;
}

/**
 * Context the tool passes to each write call. Contains everything needed
 * to fully describe the invocation without leaking the raw input/output
 * payloads into the audit record.
 */
export interface SkillAuditWriteContext {
  subject: string;
  skillId: string;
  actionId: string;
  bundleId: string;
  bundleVersion: string;
  /** Raw input — hashed via JCS before storage. Never persisted verbatim. */
  input: unknown;
}

/** Extra fields for the http-call-success path. */
export interface SkillAuditSuccessExtras {
  status: number;
  /** Response body — hashed via JCS before storage. */
  output: unknown;
}

/** Extra fields for the http-call-failure path. */
export interface SkillAuditFailureExtras {
  status: number;
  /** Free-form error description — truncated/redacted into `errorMessage`. */
  error: unknown;
}

/** Extra fields for the authority-check-fail path. */
export interface SkillAuditAuthorityFailExtras {
  /** Reason from the AuthorityGuard (e.g. `'roles missing: admin'`). */
  reason: string;
}

/**
 * Maximum length of the truncated error message persisted in the record.
 * Picked to fit comfortably in any storage backend's value-size budget while
 * still being long enough to identify the failure mode.
 */
export const SKILL_AUDIT_ERROR_MESSAGE_MAX = 500;

/**
 * Maximum number of pending audit writes queued in-process. When the queue
 * is full new writes are dropped (with a metrics increment + warn log)
 * instead of blocking the tool. Picked to absorb a few seconds of slow-store
 * latency at the project's expected QPS without becoming a memory landmine
 * during sustained backend outage.
 */
export const SKILL_AUDIT_QUEUE_MAX = 1000;

/**
 * Options accepted by {@link SkillAuditWriter}. All fields optional — sane
 * defaults match the previous behavior except for `subjectMode`, which
 * defaults to `'hash'` for GDPR friendliness.
 */
export interface SkillAuditWriterOptions {
  /** See {@link SkillAuditSubjectMode}. Default: `'hash'`. */
  subjectMode?: SkillAuditSubjectMode;
  /**
   * Secret used for the subject HMAC when `subjectMode: 'hash'`. Hosts
   * SHOULD pass a stable, host-managed key (typically the same audit
   * secret you use for HS256 signing). When omitted, a deterministic key
   * is derived from the signer's keyId so subject hashes are stable
   * within the process — but NOT across restarts unless the signer keyId
   * is also stable.
   */
  subjectHashSecret?: Uint8Array;
  /** See {@link SKILL_AUDIT_QUEUE_MAX}. Default: 1000. */
  maxQueueDepth?: number;
}

/**
 * Audit writer service. Constructed once per scope and resolved out of DI
 * by the ExecuteActionTool. Calls return a promise that resolves after the
 * chained store work completes — but the tool detaches that promise so a
 * slow audit backend never directly slows every skill invocation.
 */
export class SkillAuditWriter {
  /**
   * Single-flight queue: every append() chains onto this promise so the
   * read-tail-then-append-with-prevHash sequence stays atomic per process.
   * This is the mate to the storage adapter's `incr` for cross-pod safety.
   */
  private chainHeadLock: Promise<void> = Promise.resolve();

  /** Current in-flight queue depth (records awaiting the chain head lock). */
  private queueDepth = 0;

  private readonly subjectMode: SkillAuditSubjectMode;
  private readonly subjectHashSecret: Uint8Array;
  private readonly maxQueueDepth: number;

  constructor(
    private readonly store: SkillAuditStore,
    private readonly signer: SkillAuditSigner,
    private readonly logger: SkillAuditLogger,
    private readonly metrics?: SkillAuditMetrics,
    options: SkillAuditWriterOptions = {},
  ) {
    this.subjectMode = options.subjectMode ?? 'hash';
    this.subjectHashSecret = options.subjectHashSecret ?? this.deriveDefaultSubjectSecret();
    this.maxQueueDepth = options.maxQueueDepth ?? SKILL_AUDIT_QUEUE_MAX;
  }

  /**
   * Phase 2 in the tool: authority check just passed. We log the inputHash
   * here so even invocations that fail at the network layer still leave a
   * forensic breadcrumb tying the input to the policy decision.
   */
  writeAuthorityPass(ctx: SkillAuditWriteContext): Promise<void> {
    return this.write({
      phase: 'authority-check-pass',
      ctx,
    });
  }

  /**
   * Phase 2 in the tool: authority check denied. Writing this record is
   * security-relevant — without it, denied invocations would not appear in
   * the audit log at all, and the most security-relevant events (someone
   * trying to invoke an action they're not authorized for) would silently
   * disappear. The tool MUST call this before returning the denial envelope.
   */
  writeAuthorityFail(ctx: SkillAuditWriteContext, extras: SkillAuditAuthorityFailExtras): Promise<void> {
    return this.write({
      phase: 'authority-check-fail',
      ctx,
      // Re-use the errorMessage field for the denial reason so the on-disk
      // shape stays identical to other failure phases.
      error: extras.reason,
    });
  }

  /** Phase 4 in the tool, success path. */
  writeHttpCallSuccess(ctx: SkillAuditWriteContext, extras: SkillAuditSuccessExtras): Promise<void> {
    return this.write({
      phase: 'http-call-success',
      ctx,
      status: extras.status,
      output: extras.output,
    });
  }

  /** Phase 4 in the tool, failure path. */
  writeHttpCallFailure(ctx: SkillAuditWriteContext, extras: SkillAuditFailureExtras): Promise<void> {
    return this.write({
      phase: 'http-call-failure',
      ctx,
      status: extras.status,
      error: extras.error,
    });
  }

  /**
   * Wait for all pending writes to complete. Useful for tests and graceful
   * shutdown — the chain head lock resolves once every queued write has
   * finished (success or swallowed-failure). Never throws.
   */
  async flush(): Promise<void> {
    // Loop until the queue is empty — `chainHeadLock` only covers writes
    // that were already queued at the time we read it; new writes can
    // arrive while we're awaiting.
    while (this.queueDepth > 0) {
      await this.chainHeadLock;
    }
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private write(args: {
    phase: SkillAuditPhase;
    ctx: SkillAuditWriteContext;
    status?: number;
    output?: unknown;
    error?: unknown;
  }): Promise<void> {
    // Bounded queue: drop on overflow rather than back-pressuring the tool.
    // A sustained Redis outage shouldn't translate into a memory leak
    // proportional to QPS — better to lose audit records (loudly) than to
    // OOM the pod.
    if (this.queueDepth >= this.maxQueueDepth) {
      this.logger.warn(
        `[skill-audit] queue overflow (${this.queueDepth}/${this.maxQueueDepth}); dropping ${args.phase} record. ` +
          'Audit backend likely unhealthy.',
      );
      this.metrics?.incrementDropped?.('queue-overflow');
      return Promise.resolve();
    }

    this.queueDepth += 1;
    // Chain each write onto the lock so the read-tail/append sequence
    // serializes within the process. Errors inside the chain are swallowed
    // by the `.catch` below (and again inside doWrite) so a rejected
    // promise can never block the next writer.
    const next = this.chainHeadLock.then(() => this.doWrite(args));
    this.chainHeadLock = next
      .catch(() => undefined)
      .finally(() => {
        this.queueDepth -= 1;
      });
    // Returns a promise that resolves when this write is done. The tool
    // is expected to detach this with `void writer.writeXxx(...)` so the
    // hot path isn't blocked. Tests and `flush()` can still await it.
    return next.catch(() => undefined);
  }

  private async doWrite(args: {
    phase: SkillAuditPhase;
    ctx: SkillAuditWriteContext;
    status?: number;
    output?: unknown;
    error?: unknown;
  }): Promise<void> {
    const { phase, ctx, status, output, error } = args;

    // Always re-read tail from the store. The previous implementation
    // cached the tail per-process, which made multi-pod chain-break
    // problems strictly worse: a second pod against the same backing store
    // would link records against a tail it never observed. Re-reading on
    // every write is the conservative, single-writer-safe default for
    // v1.2.0; v1.3.0 will fuse this into a CAS atomic.
    let prev: SkillAuditRecord | undefined;
    try {
      prev = await this.store.tail();
    } catch (e) {
      this.logger.warn(`[skill-audit] failed to load chain tail: ${(e as Error).message}`);
      this.metrics?.incrementWriteFailure('append');
      return;
    }

    // Build the typed partial record. Hashing routes through the same JCS
    // canonicalize that bundle signing uses so a record built from object A
    // and one built from a key-shuffled clone of A are byte-identical.
    let inputHash: string;
    try {
      inputHash = sha256Hex(canonicalize(ctx.input ?? null));
    } catch (e) {
      this.logger.warn(`[skill-audit] failed to canonicalize input: ${(e as Error).message}`);
      this.metrics?.incrementWriteFailure('unexpected');
      return;
    }

    // Allocate the sequence atomically AFTER the input has been successfully
    // canonicalized. If the next steps (signing, persistence) fail, we
    // best-effort decrement the counter to avoid leaving a permanent gap
    // that the verifier reports as `sequence gap`. (M4 — not transactional
    // but better than the previous silent permanent gap.)
    let sequence: number;
    try {
      sequence = await this.store.nextSequence();
    } catch (e) {
      this.logger.warn(`[skill-audit] failed to allocate sequence: ${(e as Error).message}`);
      this.metrics?.incrementWriteFailure('append');
      return;
    }

    const partial = {
      id: randomUUID(),
      sequence,
      timestamp: new Date().toISOString(),
      subject: this.applySubjectMode(ctx.subject || 'anonymous'),
      skillId: ctx.skillId,
      actionId: ctx.actionId,
      bundleId: ctx.bundleId,
      bundleVersion: ctx.bundleVersion,
      phase,
      inputHash,
      ...(status !== undefined ? { status } : {}),
      ...(phase === 'http-call-success' ? { outputHash: this.safeHash(output) } : {}),
      ...(phase === 'http-call-failure' || phase === 'authority-check-fail'
        ? { errorMessage: this.formatError(error) }
        : {}),
    };

    // Stamp prevHash from `prev` (or the genesis sentinel for the first write).
    const linked = linkRecord(prev, partial);

    // Sign. A signer failure is treated as audit-write failure — we do NOT
    // append an unsigned record because that would be undetectable later.
    // We try to roll back the sequence counter so we don't leave a permanent
    // gap — see `tryDecrementSequence` for the best-effort caveats.
    let signed: SkillAuditRecord;
    try {
      const sig = this.signer.sign(linked);
      signed = {
        ...linked,
        signature: sig.signature,
        signatureKeyId: sig.keyId,
        signatureAlg: sig.alg,
      };
    } catch (e) {
      this.logger.warn(`[skill-audit] failed to sign record at seq=${sequence}: ${(e as Error).message}`);
      this.metrics?.incrementWriteFailure('sign');
      await this.tryDecrementSequence(sequence);
      return;
    }

    // Persist.
    try {
      await this.store.appendAtSequence(signed);
      this.logger.debug?.(`[skill-audit] appended seq=${sequence} phase=${phase}`);
    } catch (e) {
      this.logger.warn(`[skill-audit] failed to append record at seq=${sequence}: ${(e as Error).message}`);
      this.metrics?.incrementWriteFailure('append');
      await this.tryDecrementSequence(sequence);
    }
  }

  /**
   * Best-effort sequence rollback. Storage adapters that support `decr` will
   * close the gap; ones that don't are no-ops. We never throw out of this
   * helper — a failed rollback is strictly worse than a permanent gap.
   *
   * Detection is duck-typed (we look at `.adapter.decr` and `.options.sequenceKey`)
   * because the SkillAuditStore interface intentionally doesn't expose
   * sequence-mutation methods — those are storage-specific implementation
   * detail, and forcing every implementation to expose them would push the
   * complexity onto every adapter even when the underlying store can't
   * support transactional rollback.
   */
  private async tryDecrementSequence(allocated: number): Promise<void> {
    const storeAny = this.store as unknown as {
      adapter?: { decr?: (key: string) => Promise<number> };
      options?: { sequenceKey?: string };
    };
    if (!storeAny.adapter || typeof storeAny.adapter.decr !== 'function') return;
    const sequenceKey = storeAny.options?.sequenceKey ?? 'audit:skills:sequence';
    try {
      await storeAny.adapter.decr(sequenceKey);
      this.logger.debug?.(`[skill-audit] rolled back unused sequence ${allocated}`);
    } catch {
      // Swallow — not transactional, gap is acceptable.
    }
  }

  /** Apply the configured subject-mode redaction. */
  private applySubjectMode(subject: string): string {
    if (this.subjectMode === 'plain') return subject;
    if (this.subjectMode === 'omit') return 'redacted';
    // 'hash' — deterministic per-secret HMAC. Truncate to 32 hex chars
    // (16 bytes) so the on-disk footprint stays compact while keeping
    // collision probability negligible at any audit-log scale.
    const mac = hmacSha256(this.subjectHashSecret, new TextEncoder().encode(subject));
    let hex = '';
    for (let i = 0; i < mac.length; i++) {
      hex += mac[i]!.toString(16).padStart(2, '0');
    }
    return `hashed:${hex.slice(0, 32)}`;
  }

  /**
   * Default subject-hash secret derivation when the host doesn't supply one.
   * Returns a deterministic 32-byte key seeded from the signer's keyId so
   * two SkillAuditWriter instances configured against the same signer
   * produce stable subject hashes — useful for joining records across
   * writer reconfigurations within the same logical deployment. NOT a
   * cryptographic key in its own right — the host SHOULD override via
   * constructor options for production deployments.
   */
  private deriveDefaultSubjectSecret(): Uint8Array {
    const key = new Uint8Array(32);
    const seed = new TextEncoder().encode(`frontmcp:audit:subject:${this.signer.getKeyId()}`);
    for (let i = 0; i < key.length; i++) {
      key[i] = seed[i % seed.length] ?? 0;
    }
    return key;
  }

  /**
   * Hash arbitrary output. Falls back to a sentinel if canonicalization
   * fails (circular references, non-serializable values) — the verifier
   * will treat it as a hash like any other.
   */
  private safeHash(value: unknown): string {
    try {
      return sha256Hex(canonicalize(value ?? null));
    } catch {
      return sha256Hex('audit:non-canonicalizable-output');
    }
  }

  /** Truncate + sanitize an error to fit in the record. */
  private formatError(error: unknown): string {
    let raw: string;
    if (error instanceof Error) {
      raw = error.message;
    } else if (typeof error === 'string') {
      raw = error;
    } else if (error === undefined || error === null) {
      raw = '';
    } else {
      try {
        raw = JSON.stringify(error);
      } catch {
        raw = String(error);
      }
    }
    if (raw.length > SKILL_AUDIT_ERROR_MESSAGE_MAX) {
      return raw.slice(0, SKILL_AUDIT_ERROR_MESSAGE_MAX) + '...';
    }
    return raw;
  }
}

/** Sentinel for the very first record's prevHash. Re-exported for ergonomics. */
export { SKILL_AUDIT_GENESIS_PREV_HASH };
