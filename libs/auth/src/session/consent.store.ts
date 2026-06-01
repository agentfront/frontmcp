/**
 * Remembered Consent Store
 *
 * Persists a user's per-client tool-consent selection so that consent mode
 * (`auth.consent.rememberConsent`) can reuse it on a subsequent login instead
 * of re-prompting every time.
 *
 * Semantics (see {@link RememberedConsentRecord}):
 * - Keyed by `consent:{userSub}:{clientId}` — one record per (user, client).
 * - `selectedToolIds` is what the user last consented to (NOT including
 *   `excludedTools`, which are always available regardless of consent).
 * - `seenToolIds` is the full set of tool ids that were OFFERED the last time
 *   consent was collected. On a later login the consent screen is SKIPPED only
 *   when every currently-available tool id is already in `seenToolIds` (i.e. no
 *   NEW tool appeared). If a new tool appeared, the screen is re-rendered
 *   pre-filled with `selectedToolIds` so the user decides about the new one —
 *   a newly-added tool is NEVER silently granted.
 *
 * No PII is stored: only the opaque subject identifier, the client id, and tool
 * ids. The minted token's `consent.selectedTools` claim still drives call-time
 * enforcement; this store only changes which selection is collected/reused at
 * authorize time.
 *
 * Parallels {@link FederatedAuthSessionStore}: an {@link InMemoryConsentStore}
 * for the default (memory) path and a `StorageConsentStore` (adapter-backed) for
 * Redis/SQLite, swapped in when a persistent token-storage backend is
 * configured.
 */

/**
 * A remembered per-(user, client) consent selection.
 */
export interface RememberedConsentRecord {
  /** Opaque subject identifier of the consenting user. */
  userSub: string;
  /** OAuth client id the consent was granted to. */
  clientId: string;
  /**
   * Tool ids the user last consented to. Does NOT include `excludedTools`
   * (those are always available and are merged in at mint time).
   */
  selectedToolIds: string[];
  /**
   * Full set of tool ids that were OFFERED when consent was last collected.
   * Used to detect newly-added tools (available ids not in this set) so the
   * screen is re-shown rather than silently granting a new tool.
   */
  seenToolIds: string[];
  /** Last-updated timestamp (epoch ms). */
  updatedAt: number;
}

/**
 * Store interface for remembered consent selections.
 */
export interface ConsentStore {
  /** Get the remembered consent record for a (user, client), or null. */
  get(userSub: string, clientId: string): Promise<RememberedConsentRecord | null>;

  /** Persist (insert or overwrite) a remembered consent record. */
  set(record: RememberedConsentRecord): Promise<void>;

  /** Delete the remembered consent record for a (user, client). */
  delete(userSub: string, clientId: string): Promise<void>;
}

/**
 * Build the storage key for a remembered consent record.
 *
 * Shared by both store implementations so the in-memory and adapter-backed
 * variants can never drift on key shape.
 */
export function consentRecordKey(userSub: string, clientId: string): string {
  return `consent:${userSub}:${clientId}`;
}

/**
 * In-Memory Remembered Consent Store.
 *
 * Default (memory) implementation; the remembered selection is lost on restart,
 * matching the rest of the in-memory auth stores. Use a persistent backend
 * (Redis/SQLite via `tokenStorage`) to survive restarts.
 */
export class InMemoryConsentStore implements ConsentStore {
  private readonly records = new Map<string, RememberedConsentRecord>();

  async get(userSub: string, clientId: string): Promise<RememberedConsentRecord | null> {
    const record = this.records.get(consentRecordKey(userSub, clientId));
    if (!record) return null;
    // Return a defensive copy so callers cannot mutate the stored record.
    return { ...record, selectedToolIds: [...record.selectedToolIds], seenToolIds: [...record.seenToolIds] };
  }

  async set(record: RememberedConsentRecord): Promise<void> {
    // Defensive copy (including the arrays) so later mutation of the caller's
    // record cannot corrupt the stored selection.
    this.records.set(consentRecordKey(record.userSub, record.clientId), {
      ...record,
      selectedToolIds: [...record.selectedToolIds],
      seenToolIds: [...record.seenToolIds],
    });
  }

  async delete(userSub: string, clientId: string): Promise<void> {
    this.records.delete(consentRecordKey(userSub, clientId));
  }

  /** Number of remembered records (for testing/monitoring). */
  get size(): number {
    return this.records.size;
  }

  /** Clear all remembered records (for testing). */
  clear(): void {
    this.records.clear();
  }
}
