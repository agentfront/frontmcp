// file: plugins/plugin-skilled-openapi/src/registry/hidden-op.registry.ts

import type { AuthBinding, AuthoritiesPolicy, OperationDescriptor, ServiceDescriptor } from '@frontmcp/adapters/skills';

/**
 * Plugin-private map of `(skillId, actionId) -> OperationDescriptor`.
 *
 * This is the SOLE resolution path for hidden operations. The registry is NOT
 * exported from the plugin's public surface and is NOT a DI provider that
 * other code paths can inject — it's reachable ONLY through the plugin's
 * meta-tools and operation tools, which act as the authorization checkpoint.
 *
 * The registry also holds the bundle's services map and auth bindings so the
 * executor can resolve outbound URLs and credentials from the same source of
 * truth that gates discovery.
 */
export interface HiddenOpEntry {
  /** Skill that owns this operation (used for ABAC namespacing). */
  skillId: string;
  /**
   * Skill-level required-authorities policy (`BundledSkill.requiredAuthorities`),
   * pinned with the entry. AND-ed with the op-level policy at execution time so
   * a skill-wide gate actually protects every op of the skill (C2).
   */
  skillRequiredAuthorities?: AuthoritiesPolicy;
  /** Operation descriptor (immutable for the lifetime of this entry). */
  op: OperationDescriptor;
  /** Resolved service this op lives in. */
  service: ServiceDescriptor;
  /** Resolved auth binding for outbound credential injection. */
  authBinding: AuthBinding;
  /** Bundle id this entry came from. Pinned with the entry so a hot bundle-swap mid-call cannot route the op through a different bundle's credential scope. */
  bundleId: string;
  /** The bundle version this entry came from. Pinned at call entry to survive bundle hot-swap mid-call. */
  bundleVersion: string;
}

/** The entries of every skill that lists one operation, in bundle order. */
export type OperationListings = readonly [HiddenOpEntry, ...HiddenOpEntry[]];

const key = (skillId: string, actionId: string): string => `${skillId}\0${actionId}`;

export class HiddenOpRegistry {
  private entries = new Map<string, HiddenOpEntry>();

  /** Number of entries currently registered. Used for `/healthz`. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Look up the operation registered for `(skillId, actionId)`. Returns
   * undefined if the skill or action is unknown — the meta-tool surfaces this
   * as a structured error to the caller.
   */
  get(skillId: string, actionId: string): HiddenOpEntry | undefined {
    return this.entries.get(key(skillId, actionId));
  }

  /**
   * Resolve an operation by actionId (operationId) ALONE — used by the enclave
   * codecall (`run_workflow`), where a sandboxed script calls
   * `callTool(actionId, input)` without naming a skill. Several skills may list
   * the same operation, each with its own skill-level rule, so this returns the
   * entry of every one of them; undefined when no skill lists the action.
   */
  listingsOf(actionId: string): OperationListings | undefined {
    const [firstListing, ...otherListings] = [...this.entries.values()].filter(
      (entry) => entry.op.operationId === actionId,
    );
    return firstListing ? [firstListing, ...otherListings] : undefined;
  }

  /** Set or replace the entry for `(skillId, actionId)`. */
  set(entry: HiddenOpEntry): void {
    this.entries.set(key(entry.skillId, entry.op.operationId), entry);
  }

  /** Remove the entry for `(skillId, actionId)`. Returns true if anything was removed. */
  delete(skillId: string, actionId: string): boolean {
    return this.entries.delete(key(skillId, actionId));
  }

  /**
   * Remove every entry belonging to `skillId`. Used when a skill is removed
   * by a bundle swap. Returns the number of entries removed.
   */
  deleteSkill(skillId: string): number {
    const prefix = `${skillId}\0`;
    let removed = 0;
    for (const k of [...this.entries.keys()]) {
      if (k.startsWith(prefix)) {
        this.entries.delete(k);
        removed++;
      }
    }
    return removed;
  }

  /** A copy of the registry as it is now: a later bundle swap changes this registry, never the copy. */
  snapshot(): HiddenOpRegistry {
    const copy = new HiddenOpRegistry();
    copy.entries = new Map(this.entries);
    return copy;
  }

  /** Iterate all entries. Used by `/healthz` and audit log. */
  values(): IterableIterator<HiddenOpEntry> {
    return this.entries.values();
  }

  /** Reset to empty state (used by tests and panic-button). */
  clear(): void {
    this.entries.clear();
  }
}
