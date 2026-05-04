// file: plugins/plugin-skilled-openapi/src/bundle/bundle.store.ts

import { diffBundles, type BundleDiff } from './bundle-diff';
import type { ResolvedBundle } from './bundle.types';

export type BundleSwapListener = (event: {
  previous: ResolvedBundle | undefined;
  current: ResolvedBundle;
  diff: BundleDiff;
}) => void;

/**
 * In-memory holder for the active bundle. Atomic swap-or-rollback semantics:
 * `swap()` either fully transitions to the new bundle (and returns the diff)
 * or throws and leaves the previous bundle untouched.
 *
 * Listeners are notified ONLY after a successful swap. They run synchronously
 * — keep them cheap; offload heavy work to a queue.
 */
export class BundleStore {
  private active: ResolvedBundle | undefined;
  private listeners = new Set<BundleSwapListener>();

  current(): ResolvedBundle | undefined {
    return this.active;
  }

  /**
   * Swap to a new bundle. Returns the structural diff (no-op = same version
   * with no field changes; the swap itself still fires listeners with isNoOp=true
   * so observers can record the heartbeat).
   */
  swap(next: ResolvedBundle): BundleDiff {
    if (!next) {
      throw new Error('BundleStore.swap: bundle is required');
    }
    const previous = this.active;
    const diff = diffBundles(previous, next);
    this.active = next;
    for (const fn of this.listeners) {
      try {
        fn({ previous, current: next, diff });
      } catch {
        // Listener errors must not poison the swap. They're logged at the call
        // site (sync service) where the logger context is richer.
      }
    }
    return diff;
  }

  /** Subscribe to swap events. Returns an unsubscribe function. */
  subscribe(fn: BundleSwapListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Reset to empty state. Used by tests. Does NOT fire listeners. */
  reset(): void {
    this.active = undefined;
  }
}
