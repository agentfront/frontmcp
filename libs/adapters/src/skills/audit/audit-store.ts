// file: libs/adapters/src/skills/audit/audit-store.ts
//
// Persistence layer for skill audit records. The store is the only place
// where the chain head is materialized — the writer treats it as the source
// of truth for `tail()` so that a process restart picks up the existing
// chain instead of forking a parallel one (which would mint sequence=1
// twice and immediately invalidate verification).
//
// Two implementations ship:
//   - `MemoryAuditStore`: in-process append-only log, wired in by default.
//   - `StorageAdapterAuditStore`: wraps any `@frontmcp/utils` StorageAdapter
//     (memory / Redis / Vercel KV / Upstash / SQLite). Atomic sequence is
//     allocated via `incr` so concurrent pods don't collide.

import type { StorageAdapter } from '@frontmcp/utils';

import { SKILL_AUDIT_KEYS, type SkillAuditRecord } from './audit-record.types';

/**
 * Read filter for forensic / verifier traversal.
 * - `from`: starting sequence (inclusive). Default: 1.
 * - `limit`: max records to return. Default: unlimited.
 */
export interface SkillAuditReadOptions {
  from?: number;
  limit?: number;
}

/**
 * Common contract for audit stores. The writer relies on `appendAtSequence`
 * being effectively atomic: two concurrent calls with the same `sequence`
 * must result in exactly one of them succeeding (the other should throw or
 * silently no-op based on `ifNotExists` semantics — both are acceptable).
 *
 * The writer guarantees per-process serialization via a Promise queue, so
 * the contract really matters for cross-pod ordering.
 */
export interface SkillAuditStore {
  /**
   * Allocate the next monotonic sequence number. In production this maps to
   * `StorageAdapter.incr(...)` which Redis / Vercel KV / Upstash / SQLite
   * all expose atomically.
   */
  nextSequence(): Promise<number>;

  /**
   * Persist a record at its claimed sequence. Implementations should fail
   * (throw) or no-op if a record already exists at that sequence — this
   * keeps the chain head from being clobbered.
   */
  appendAtSequence(record: SkillAuditRecord): Promise<void>;

  /**
   * Most recent record in the chain, or undefined for an empty chain. Used
   * by the writer to compute `prevHash` for the next record. Must reflect
   * cross-process state for HA correctness.
   */
  tail(): Promise<SkillAuditRecord | undefined>;

  /** Read records in sequence order. Used by the verifier and by HTTP viewers. */
  read(opts?: SkillAuditReadOptions): Promise<SkillAuditRecord[]>;
}

// ─── In-memory implementation ───────────────────────────────────────────────

/**
 * Process-local append-only audit log. Suitable for tests, dev environments,
 * and single-pod deployments where audit durability is not required across
 * restarts. For HA / multi-pod, use {@link StorageAdapterAuditStore}.
 */
export class MemoryAuditStore implements SkillAuditStore {
  private readonly records: SkillAuditRecord[] = [];
  private seq = 0;

  async nextSequence(): Promise<number> {
    this.seq += 1;
    return this.seq;
  }

  async appendAtSequence(record: SkillAuditRecord): Promise<void> {
    // Idempotent at the record level — if the same sequence is appended
    // twice (e.g. retry after a transient failure further down the writer),
    // we keep the first one.
    if (this.records.some((r) => r.sequence === record.sequence)) {
      throw new Error(`MemoryAuditStore: record at sequence ${record.sequence} already exists`);
    }
    this.records.push(record);
  }

  async tail(): Promise<SkillAuditRecord | undefined> {
    if (this.records.length === 0) return undefined;
    return this.records[this.records.length - 1];
  }

  async read(opts?: SkillAuditReadOptions): Promise<SkillAuditRecord[]> {
    const from = opts?.from ?? 1;
    const limit = opts?.limit;
    const filtered = this.records.filter((r) => r.sequence >= from);
    const sliced = limit !== undefined ? filtered.slice(0, limit) : filtered;
    // Stable, sorted by sequence.
    return [...sliced].sort((a, b) => a.sequence - b.sequence);
  }
}

// ─── StorageAdapter-backed implementation ──────────────────────────────────

/**
 * Backed by a `@frontmcp/utils` StorageAdapter. Sequence allocation uses
 * `adapter.incr(...)` for atomic monotonicity across pods; per-record
 * persistence uses `adapter.set(... , { ifNotExists: true })` so a retry
 * after a partial failure doesn't overwrite the original record.
 */
export class StorageAdapterAuditStore implements SkillAuditStore {
  constructor(
    private readonly adapter: StorageAdapter,
    private readonly options: {
      sequenceKey?: string;
      recordKeyPrefix?: string;
      /**
       * Maximum number of sequence slots to scan when looking for the chain
       * tail. Default 1024. See {@link tail} for context — a partial write
       * that incremented the counter without persisting the record leaves a
       * hole; we walk backward past those, and this cap prevents an
       * unbounded scan if every recent slot was lost.
       */
      tailLookback?: number;
    } = {},
  ) {}

  private get sequenceKey(): string {
    return this.options.sequenceKey ?? SKILL_AUDIT_KEYS.sequence;
  }

  private recordKey(sequence: number): string {
    const prefix = this.options.recordKeyPrefix;
    return prefix ? `${prefix}${sequence}` : SKILL_AUDIT_KEYS.record(sequence);
  }

  async nextSequence(): Promise<number> {
    return this.adapter.incr(this.sequenceKey);
  }

  async appendAtSequence(record: SkillAuditRecord): Promise<void> {
    const key = this.recordKey(record.sequence);
    // Defensive existence check: if a record already lives at this sequence
    // we refuse to write, surfacing the contention to the caller rather
    // than silently swallowing the second record. Combined with the
    // ifNotExists flag below, the only remaining race is two concurrent
    // first-time writes — and the post-write verification catches that.
    const existing = await this.adapter.get(key);
    if (existing !== null) {
      throw new Error(`StorageAdapterAuditStore: record at sequence ${record.sequence} already exists`);
    }
    const payload = JSON.stringify(record);
    await this.adapter.set(key, payload, { ifNotExists: true });
    // Verify-after-write so a race where two writers think they own the
    // same sequence surfaces here rather than corrupting the chain silently.
    const stored = await this.adapter.get(key);
    if (stored !== payload) {
      throw new Error(`StorageAdapterAuditStore: record at sequence ${record.sequence} was clobbered or not stored`);
    }
  }

  async tail(): Promise<SkillAuditRecord | undefined> {
    const seqRaw = await this.adapter.get(this.sequenceKey);
    if (!seqRaw) return undefined;
    const seq = Number.parseInt(seqRaw, 10);
    if (!Number.isFinite(seq) || seq <= 0) return undefined;

    // Walk backwards skipping holes — in practice there shouldn't be holes,
    // but a partial write that increments the counter without persisting the
    // record would leave one. Cap lookbacks so a corrupted store doesn't
    // deadlock the writer at boot. The default of 1024 absorbs a worst-case
    // burst of failed appends that incremented the counter without writing.
    // Operators with longer outage windows can override via constructor opts.
    const maxLookback = this.options.tailLookback ?? 1024;
    for (let s = seq; s > 0 && s > seq - maxLookback; s--) {
      const raw = await this.adapter.get(this.recordKey(s));
      if (!raw) continue;
      try {
        return JSON.parse(raw) as SkillAuditRecord;
      } catch {
        // Surface the bad record rather than swallowing it — a corrupted
        // tail is exactly the kind of state the verifier needs to catch.
        // Returning undefined would silently restart the chain at genesis
        // (linking the next record with the all-zeros sentinel), which is
        // strictly worse than a verifier error at boot.
        throw new Error(`StorageAdapterAuditStore.tail: corrupt record at sequence ${s} cannot be parsed as JSON`);
      }
    }
    return undefined;
  }

  async read(opts?: SkillAuditReadOptions): Promise<SkillAuditRecord[]> {
    const seqRaw = await this.adapter.get(this.sequenceKey);
    if (!seqRaw) return [];
    const head = Number.parseInt(seqRaw, 10);
    if (!Number.isFinite(head) || head <= 0) return [];

    const from = Math.max(1, opts?.from ?? 1);
    const limit = opts?.limit;
    const out: SkillAuditRecord[] = [];

    for (let s = from; s <= head; s++) {
      const raw = await this.adapter.get(this.recordKey(s));
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as SkillAuditRecord;
        out.push(parsed);
        if (limit !== undefined && out.length >= limit) break;
      } catch {
        // Skip unparseable records — verifier will detect the gap.
      }
    }

    return out;
  }
}
