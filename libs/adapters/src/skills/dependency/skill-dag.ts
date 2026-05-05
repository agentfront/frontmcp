// file: libs/adapters/src/skills/dependency/skill-dag.ts
//
// Dependency resolution for skill bundles. The bundle schema's `requires`
// field declares an inter-skill dependency edge; this module turns the
// declared edges into a deterministic load order so a skill that references
// another skill in its instructions can rely on that other skill being
// registered first.
//
// Algorithm: Kahn's topological sort with a deterministic tie-break (sort
// candidates by id). Cycles + missing dependencies are surfaced as typed
// errors so callers can decide whether to abort the whole apply or skip
// just the failing skill.

import type { BundledSkill } from '../bundle/bundle.types';

/**
 * Thrown when the `requires` graph contains a cycle. `cycle` lists the ids
 * forming the offending chain (first id appears once at the end too, so the
 * loop is visible at a glance).
 */
export class SkillDependencyCycleError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`skill dependency cycle: ${cycle.join(' -> ')}`);
    this.name = 'SkillDependencyCycleError';
  }
}

/**
 * Thrown when a skill declares `requires: [otherId]` but `otherId` is not
 * present in the bundle.
 */
export class SkillDependencyMissingError extends Error {
  constructor(
    public readonly skillId: string,
    public readonly missingId: string,
  ) {
    super(`skill "${skillId}" requires unknown skill "${missingId}"`);
    this.name = 'SkillDependencyMissingError';
  }
}

/**
 * Thrown when an internal invariant of the resolver is violated (e.g. the
 * `ready` queue and `byId` map disagree). Surfaces as a typed error rather
 * than a generic Error so callers can distinguish "bug in the resolver"
 * from "bad input".
 */
export class SkillDependencyInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillDependencyInvariantError';
  }
}

/**
 * Compute the dependency-respecting load order for a list of skills.
 *
 * Returns a fresh array — input is not mutated. Tie-break is alphabetical by
 * id so the order is deterministic across runs (helps tests + audit logs).
 *
 * Throws `SkillDependencyMissingError` for unknown ids and
 * `SkillDependencyCycleError` for cycles.
 */
export function resolveSkillLoadOrder(skills: BundledSkill[]): BundledSkill[] {
  const byId = new Map<string, BundledSkill>();
  for (const skill of skills) {
    if (byId.has(skill.id)) {
      // Caller layered duplicate ids — last write wins, but that's a
      // conscious choice they made before we got here.
      byId.set(skill.id, skill);
      continue;
    }
    byId.set(skill.id, skill);
  }

  // Validate edges + build adjacency. `requiredBy` is the reverse edge so
  // we can fan out efficiently as nodes drain.
  const inDegree = new Map<string, number>();
  const requiredBy = new Map<string, string[]>(); // id -> ids that depend on it

  for (const id of byId.keys()) {
    inDegree.set(id, 0);
    requiredBy.set(id, []);
  }

  for (const skill of byId.values()) {
    const deps = skill.requires ?? [];
    for (const depId of deps) {
      if (!byId.has(depId)) {
        throw new SkillDependencyMissingError(skill.id, depId);
      }
      inDegree.set(skill.id, (inDegree.get(skill.id) ?? 0) + 1);
      // requiredBy is seeded with `[]` for every id above, so this lookup
      // is guaranteed to hit; default to an unused empty array if the
      // invariant is ever broken to keep the loop deterministic.
      const reverse = requiredBy.get(depId) ?? [];
      reverse.push(skill.id);
      requiredBy.set(depId, reverse);
    }
  }

  // Kahn: seed with zero-in-degree nodes, sorted by id for determinism.
  const ready: string[] = [...byId.keys()].filter((id) => inDegree.get(id) === 0).sort();
  const order: BundledSkill[] = [];

  while (ready.length > 0) {
    const next = ready.shift();
    if (next === undefined) {
      throw new SkillDependencyInvariantError(
        'resolveSkillLoadOrder: invariant broken — ready queue drained mid-iteration',
      );
    }
    const nextSkill = byId.get(next);
    if (!nextSkill) {
      throw new SkillDependencyInvariantError(
        `resolveSkillLoadOrder: invariant broken — id "${next}" missing from byId map`,
      );
    }
    order.push(nextSkill);
    for (const dependent of requiredBy.get(next) ?? []) {
      const remaining = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, remaining);
      if (remaining === 0) {
        // Insert in sorted position so the next pop is the smallest id.
        let i = 0;
        while (i < ready.length && ready[i] < dependent) i++;
        ready.splice(i, 0, dependent);
      }
    }
  }

  if (order.length === byId.size) {
    return order;
  }

  // Cycle: find one to surface in the error message.
  const remainingIds = [...byId.keys()].filter((id) => (inDegree.get(id) ?? 0) > 0);
  const cycle = findCycle(remainingIds, byId);
  throw new SkillDependencyCycleError(cycle);
}

/**
 * Walk the residual graph (nodes with non-zero in-degree) until a back edge
 * is found. Returns the cycle as `[a, b, c, a]` so the loop is visible.
 */
function findCycle(remaining: string[], byId: Map<string, BundledSkill>): string[] {
  const adj = new Map<string, string[]>();
  for (const id of remaining) {
    adj.set(
      id,
      (byId.get(id)?.requires ?? []).filter((d) => remaining.includes(d)),
    );
  }
  // DFS from each remaining node looking for a back edge to a gray ancestor.
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of remaining) color.set(id, WHITE);
  const stack: string[] = [];

  function dfs(node: string): string[] | undefined {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of adj.get(node) ?? []) {
      const c = color.get(next);
      if (c === GRAY) {
        // Back edge — slice the stack from `next` to `node` and append `next`.
        const startIdx = stack.indexOf(next);
        return [...stack.slice(startIdx), next];
      }
      if (c === WHITE) {
        const found = dfs(next);
        if (found) return found;
      }
    }
    color.set(node, BLACK);
    stack.pop();
    return undefined;
  }

  for (const id of remaining) {
    if (color.get(id) === WHITE) {
      const cycle = dfs(id);
      if (cycle) return cycle;
    }
  }
  // Should never happen — if remaining is non-empty there must be a cycle.
  return remaining;
}
