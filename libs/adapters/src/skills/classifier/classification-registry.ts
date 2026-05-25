// file: libs/adapters/src/skills/classifier/classification-registry.ts
//
// Lightweight in-memory registry that maps a tool name (e.g.
// `acme.getUserById`) to its `ClassifiedOperation`. Populated by the deploy
// pipeline at boot from the build-time classifier output; queried by the
// runtime dispatcher after every successful tool call.
//
// Stays in `@frontmcp/adapters/skills/classifier` rather than the SDK
// because classification is part of the openapi -> MCP wiring, not part of
// the core protocol layer. The actual `tools/call` hook that consumes it is
// in the openapi adapter (or wherever the deploy pipeline wires it in).

import type { ClassifiedOperation } from './openapi-classify';
import { buildResourceChangeNotification, type BuildNotificationResult } from './resource-change-notification';

/** Snapshot view returned by `getAll()`. */
export interface ClassificationRegistrySnapshot {
  toolName: string;
  classification: ClassifiedOperation;
}

/**
 * In-memory registry keyed by tool name. The tool name follows the
 * `${specId}.${operationId}` convention produced by
 * `OperationToolFactory.operationToolName()` in `plugin-skilled-openapi`.
 *
 * Designed as a *storage* primitive — no protocol behaviour, no DI tokens,
 * no decorators. The deploy pipeline owns population; the runtime
 * dispatcher owns lookup + notification building.
 */
export class ClassificationRegistry {
  private readonly byToolName = new Map<string, ClassifiedOperation>();

  /**
   * Register (or replace) a classification for a tool name. Returns the
   * previous classification if one existed.
   *
   * Useful for hot-reload: the deploy pipeline re-builds classifications
   * from the new bundle and overwrites in place.
   */
  register(toolName: string, classification: ClassifiedOperation): ClassifiedOperation | undefined {
    if (typeof toolName !== 'string' || toolName.length === 0) {
      throw new Error('ClassificationRegistry.register: toolName must be a non-empty string');
    }
    const prev = this.byToolName.get(toolName);
    this.byToolName.set(toolName, classification);
    return prev;
  }

  /**
   * Bulk-register an array of classifications keyed by `${specId}.${operationId}`.
   * Returns the count of newly-added entries (existing entries are overwritten
   * but not counted toward `added`).
   */
  registerAll(classifications: ReadonlyArray<ClassifiedOperation>): { added: number; replaced: number } {
    let added = 0;
    let replaced = 0;
    for (const c of classifications) {
      const toolName = `${c.specId}.${c.operationId}`;
      const prev = this.byToolName.get(toolName);
      this.byToolName.set(toolName, c);
      if (prev) replaced++;
      else added++;
    }
    return { added, replaced };
  }

  /** Look up the classification for a tool. */
  lookup(toolName: string): ClassifiedOperation | undefined {
    return this.byToolName.get(toolName);
  }

  /** Remove a single classification. Returns true if it was present. */
  unregister(toolName: string): boolean {
    return this.byToolName.delete(toolName);
  }

  /** Drop every registration; used by the loader on full re-deploy. */
  clear(): void {
    this.byToolName.clear();
  }

  /** Current size — handy for tests and metrics. */
  size(): number {
    return this.byToolName.size;
  }

  /** Snapshot of every (toolName, classification) pair in insertion order. */
  getAll(): ClassificationRegistrySnapshot[] {
    const out: ClassificationRegistrySnapshot[] = [];
    for (const [toolName, classification] of this.byToolName.entries()) {
      out.push({ toolName, classification });
    }
    return out;
  }

  /**
   * Convenience: in one step, look up the classification for `toolName`
   * and build the resource-change notification it should produce after a
   * successful call with `args`. Returns `{ notification: null }` when the
   * tool has no classification (e.g. it's not an openapi-derived tool) or
   * when its classification has no `emit`.
   *
   * The dispatcher is expected to call this from a successful-call hook
   * and forward the resulting notification through whichever notification
   * channel the host provides.
   */
  buildNotificationForCall(toolName: string, args: unknown): BuildNotificationResult {
    const classification = this.byToolName.get(toolName);
    if (!classification) return { notification: null, reason: 'no-emit' };
    return buildResourceChangeNotification(classification, args);
  }
}
