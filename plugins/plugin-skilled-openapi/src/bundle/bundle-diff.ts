// file: plugins/plugin-skilled-openapi/src/bundle/bundle-diff.ts

import type { OperationDescriptor, ResolvedBundle } from './bundle.types';

export interface BundleDiff {
  /** Skill ids added by the new bundle (not present in old). */
  addedSkillIds: string[];
  /** Skill ids removed (present in old, not in new). */
  removedSkillIds: string[];
  /** Skill ids whose content changed (registered in both, differing fields). */
  changedSkillIds: string[];
  /** Operation ids added. */
  addedOperationIds: string[];
  /** Operation ids removed. */
  removedOperationIds: string[];
  /** Operation ids whose descriptor changed. */
  changedOperationIds: string[];
  /** True if the diff is structurally a no-op (same version + same content). */
  isNoOp: boolean;
}

const opEqual = (a: OperationDescriptor, b: OperationDescriptor): boolean =>
  a.operationId === b.operationId &&
  a.serviceId === b.serviceId &&
  a.httpMethod === b.httpMethod &&
  a.pathTemplate === b.pathTemplate &&
  a.authBindingRef === b.authBindingRef &&
  JSON.stringify(a.mapper ?? null) === JSON.stringify(b.mapper ?? null) &&
  JSON.stringify(a.inputSchema) === JSON.stringify(b.inputSchema) &&
  JSON.stringify(a.outputSchema) === JSON.stringify(b.outputSchema) &&
  JSON.stringify(a.requiredAuthorities ?? null) === JSON.stringify(b.requiredAuthorities ?? null) &&
  a.maxResponseBytes === b.maxResponseBytes &&
  a.timeoutMs === b.timeoutMs;

const skillEqual = (a: ResolvedBundle['skills'][number], b: ResolvedBundle['skills'][number]): boolean =>
  a.id === b.id &&
  a.name === b.name &&
  a.description === b.description &&
  a.instructions === b.instructions &&
  JSON.stringify(a.tags ?? []) === JSON.stringify(b.tags ?? []) &&
  JSON.stringify(a.operationIds) === JSON.stringify(b.operationIds) &&
  JSON.stringify(a.requiredAuthorities ?? null) === JSON.stringify(b.requiredAuthorities ?? null);

/**
 * Compute the structural diff between two bundles.
 *
 * `oldBundle === undefined` means "no previous bundle" — every skill / op is
 * treated as added. Identity is by `id` for skills and by `operationId` for ops.
 */
export function diffBundles(oldBundle: ResolvedBundle | undefined, newBundle: ResolvedBundle): BundleDiff {
  const oldSkills = new Map((oldBundle?.skills ?? []).map((s) => [s.id, s] as const));
  const newSkills = new Map(newBundle.skills.map((s) => [s.id, s] as const));

  const addedSkillIds: string[] = [];
  const removedSkillIds: string[] = [];
  const changedSkillIds: string[] = [];

  for (const [id, skill] of newSkills) {
    const prev = oldSkills.get(id);
    if (!prev) addedSkillIds.push(id);
    else if (!skillEqual(prev, skill)) changedSkillIds.push(id);
  }
  for (const id of oldSkills.keys()) {
    if (!newSkills.has(id)) removedSkillIds.push(id);
  }

  const oldOps = oldBundle?.operations ?? {};
  const newOps = newBundle.operations;

  const addedOperationIds: string[] = [];
  const removedOperationIds: string[] = [];
  const changedOperationIds: string[] = [];

  for (const [id, op] of Object.entries(newOps)) {
    const prev = oldOps[id];
    if (!prev) addedOperationIds.push(id);
    else if (!opEqual(prev, op)) changedOperationIds.push(id);
  }
  for (const id of Object.keys(oldOps)) {
    if (!(id in newOps)) removedOperationIds.push(id);
  }

  const isNoOp =
    !!oldBundle &&
    oldBundle.version === newBundle.version &&
    addedSkillIds.length === 0 &&
    removedSkillIds.length === 0 &&
    changedSkillIds.length === 0 &&
    addedOperationIds.length === 0 &&
    removedOperationIds.length === 0 &&
    changedOperationIds.length === 0;

  return {
    addedSkillIds,
    removedSkillIds,
    changedSkillIds,
    addedOperationIds,
    removedOperationIds,
    changedOperationIds,
    isNoOp,
  };
}

/**
 * Render a one-line audit-friendly summary of a diff.
 * Used by the bundle-swap log line that operators tail for rug-pull detection.
 */
export function formatDiffSummary(diff: BundleDiff): string {
  if (diff.isNoOp) return 'no-op';
  return [
    `+${diff.addedSkillIds.length}/-${diff.removedSkillIds.length}/~${diff.changedSkillIds.length} skills`,
    `+${diff.addedOperationIds.length}/-${diff.removedOperationIds.length}/~${diff.changedOperationIds.length} ops`,
  ].join(', ');
}
