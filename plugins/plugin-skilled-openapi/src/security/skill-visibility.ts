// file: plugins/plugin-skilled-openapi/src/security/skill-visibility.ts
//
// Which skills, and which of a bundle skill's actions, a caller may be shown.
//
// `search_skill`, `load_skill` and the skill catalog in `tools/list` read the
// SDK's skill registry directly, so without this they showed every skill, its
// instructions and its actions to any caller: a bundle skill's
// `requiredAuthorities`, an `@Skill({ authorities })` rule and the hookable
// `skills:filter` flow (feature flags, this plugin's own bundle-skill hook) were
// only applied on the SDK's own skill surfaces. Every discovery path of the
// plugin goes through here instead, and so does every action call, so a skill
// discovery hides can't be run by naming its actions.

import type { AuthoritiesPolicy, ResolvedBundle } from '@frontmcp/adapters/skills';
import type { AuthoritiesMetadata } from '@frontmcp/auth';
import {
  filterServableSkills,
  type ScopeEntry,
  type SkillAction,
  type SkillEntry,
  type SkillRegistryInterface,
} from '@frontmcp/sdk';

import type { HiddenOpEntry, HiddenOpRegistry } from '../registry/hidden-op.registry';
import type { AuthorityGuard, UnprotectedOpsPolicy } from './authority-guard';

type CallerAuthInfo = Parameters<AuthorityGuard['check']>[0]['authInfo'];

/** The part of a scope that decides which skills the current caller may see. */
export type SkillFilterScope = Pick<ScopeEntry, 'skills' | 'runFlowForOutput'>;

/** The listings of an operation that count for the caller: those whose skill the `skills:filter` flow shows them. */
export type VisibleListings = (listings: readonly HiddenOpEntry[]) => Promise<HiddenOpEntry[]>;

export interface SkillVisibilityDeps {
  scope: ScopeEntry;
  guard: AuthorityGuard;
  /** The active bundle, whose skill-level `requiredAuthorities` gate its skills. */
  bundle: ResolvedBundle | undefined;
  unprotectedOps: UnprotectedOpsPolicy;
  /** The caller's AuthInfo. */
  authInfo: unknown;
}

/** The skill-level rule of each skill in `bundle` that has one. */
export function bundleSkillPolicies(bundle: ResolvedBundle | undefined): Map<string, AuthoritiesPolicy> {
  const policies = new Map<string, AuthoritiesPolicy>();
  for (const skill of bundle?.skills ?? []) {
    if (skill.requiredAuthorities !== undefined && skill.requiredAuthorities !== null) {
      policies.set(skill.id, skill.requiredAuthorities);
    }
  }
  return policies;
}

/** The registered skill an id names, looked up the way the SDK's skill surfaces do. */
function registeredSkill(registry: SkillRegistryInterface, id: string): SkillEntry | undefined {
  return (
    registry.findByName(id) ??
    (id.includes(':') ? registry.findByQualifiedName(id) : undefined) ??
    registry.getSkills(true).find((skill) => (skill.metadata.id ?? skill.name) === id || skill.metadata.name === id)
  );
}

/**
 * The listings of an operation whose skill the current caller may see, in their order: the
 * `skills:filter` flow, which decides what discovery shows, keeps the listing's registered skill.
 * A listing whose skill is not registered is left out, as discovery can't show that skill either.
 */
async function listingsVisibleToCaller(
  scope: SkillFilterScope,
  listings: readonly HiddenOpEntry[],
): Promise<HiddenOpEntry[]> {
  const registry = scope.skills;
  if (!registry) return [];
  const skillById = new Map<string, SkillEntry | undefined>();
  for (const { skillId } of listings) {
    if (!skillById.has(skillId)) skillById.set(skillId, registeredSkill(registry, skillId));
  }
  const registered = [...skillById.values()].filter((skill): skill is SkillEntry => skill !== undefined);
  const servable = new Set<SkillEntry>(await filterServableSkills(scope, registered));
  return listings.filter((listing) => {
    const skill = skillById.get(listing.skillId);
    return skill !== undefined && servable.has(skill);
  });
}

/** Judges the listings of each call against the skills registered when the call is made. */
export function visibleListingsWhenCalled(scope: SkillFilterScope): VisibleListings {
  return (listings) => listingsVisibleToCaller(scope, listings);
}

/**
 * Judges every listing of `hiddenOps` now, in one run of the `skills:filter` flow, for a workflow that runs on that
 * snapshot: a bundle swap that lands while it runs changes neither the operations it calls nor which of them count.
 */
export async function visibleListingsAtStart(
  scope: SkillFilterScope,
  hiddenOps: HiddenOpRegistry,
): Promise<VisibleListings> {
  const visible = new Set(await listingsVisibleToCaller(scope, [...hiddenOps.values()]));
  return async (listings) => listings.filter((listing) => visible.has(listing));
}

export class SkillVisibility {
  private readonly policies: Map<string, AuthoritiesPolicy>;
  private readonly authInfo: CallerAuthInfo;

  constructor(private readonly deps: SkillVisibilityDeps) {
    this.policies = bundleSkillPolicies(deps.bundle);
    this.authInfo = (deps.authInfo ?? {}) as CallerAuthInfo;
  }

  /** Whether the caller satisfies the bundle skill's own `requiredAuthorities` (true for other skills). */
  async passesBundleSkillRule(skillId: string): Promise<boolean> {
    const skillPolicy = this.policies.get(skillId);
    if (skillPolicy === undefined) return true;
    return this.deps.guard.canDiscover({ skillPolicy, authInfo: this.authInfo });
  }

  /**
   * Keep the items whose skill the caller may see: the bundle skill's rule, the
   * `skills:filter` flow and the server's `@Skill({ authorities })` rule. An item
   * whose id names no registered skill (an external skill) is judged by the bundle
   * rule alone, as the SDK's own surfaces keep such results.
   */
  async filterVisible<T>(items: readonly T[], idOf: (item: T) => string): Promise<T[]> {
    if (items.length === 0) return [];
    const entries = items.map((item) => this.resolveEntry(idOf(item)));
    const registered = [...new Set(entries.filter((entry): entry is SkillEntry => entry !== undefined))];
    const visibleEntries = new Set<SkillEntry>(await this.filterVisibleEntries(registered));

    const visible: T[] = [];
    for (const [index, item] of items.entries()) {
      const entry = entries[index];
      if (entry ? !visibleEntries.has(entry) : !(await this.passesBundleSkillRule(idOf(item)))) continue;
      visible.push(item);
    }
    return visible;
  }

  /** The registered skills the caller may see, in their order (see {@link filterVisible}). */
  async filterVisibleEntries<T extends SkillEntry>(entries: readonly T[]): Promise<T[]> {
    if (entries.length === 0) return [];
    const servable = new Set<SkillEntry>(await filterServableSkills(this.deps.scope, entries));
    const visible: T[] = [];
    for (const entry of entries) {
      if (!servable.has(entry) || !(await this.passesSkillAuthorities(entry))) continue;
      if (!(await this.passesBundleSkillRule(entry.metadata.id ?? entry.name))) continue;
      visible.push(entry);
    }
    return visible;
  }

  /** Whether the caller may see the skill named by `skillId` (see {@link filterVisible}). */
  async isVisible(skillId: string): Promise<boolean> {
    return (await this.filterVisible([skillId], (id) => id)).length === 1;
  }

  /**
   * The actions of a bundle skill the caller may be shown: an action whose rules
   * refuse the caller whatever the input (or that `unprotectedOps: 'deny'` blocks)
   * is left out. Rules that depend on the input keep the action listed; the call is
   * checked again when it runs.
   */
  async visibleActions(skillId: string, actions: readonly SkillAction[], hiddenOps: HiddenOpRegistry) {
    const visible: SkillAction[] = [];
    for (const action of actions) {
      const entry = hiddenOps.get(skillId, action.actionId);
      if (!entry) continue;
      const allowed = await this.deps.guard.canDiscover({
        policy: entry.op.requiredAuthorities,
        skillPolicy: entry.skillRequiredAuthorities,
        isPublic: entry.op.public,
        unprotectedOps: this.deps.unprotectedOps,
        authInfo: this.authInfo,
      });
      if (allowed) visible.push(action);
    }
    return visible;
  }

  /** The server's `@Skill({ authorities })` rule, evaluated as the SDK's skill surfaces do. */
  private async passesSkillAuthorities(entry: SkillEntry): Promise<boolean> {
    const { authoritiesEngine: engine, authoritiesContextBuilder: contextBuilder } = this.deps.scope;
    const authorities = (entry.metadata as unknown as Record<string, unknown>)['authorities'];
    if (!engine || !contextBuilder || !authorities) return true;
    try {
      const result = await engine.evaluate(
        authorities as AuthoritiesMetadata,
        contextBuilder.build(this.authInfo as Record<string, unknown>),
      );
      return result.granted;
    } catch {
      return false;
    }
  }

  private resolveEntry(id: string): SkillEntry | undefined {
    const registry = this.deps.scope.skills;
    return registry ? registeredSkill(registry, id) : undefined;
  }
}
