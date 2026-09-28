// file: libs/sdk/src/skill/skill-filter.helper.ts

/**
 * Runs skills through the hookable `skills:filter` flow before a surface serves them.
 *
 * Every skill surface calls one of these helpers, so a plugin that hooks the flow (the
 * feature-flag plugin, for one) gates skills on all of them at once. A skill the flow drops is
 * treated as absent: left out of listings and not found when named.
 */

import type { EntryAvailability } from '@frontmcp/utils';

import type { ScopeEntry, SkillEntry } from '../common';
import { availabilityForCall, callSurfaceOf, isOfferedOnSurface, type CallSurface } from '../common/availability';
import { getCallSurface } from '../context/call-surface';
import { filterSkillsByAuthorities } from './skill-authorities.helper';
import { createSkillEntryResolver, skillResultId, type SkillEntryLookup } from './skill-entry.resolver';

/**
 * The surface the skills HTTP endpoints (`/skills`, `/llm.txt`, `/llm_full.txt`) count as.
 *
 * They serve the clients the MCP endpoint serves (with its auth under `auth: 'inherit'`), to an
 * external reader, so a skill not offered to MCP clients (an agent-only one, say) is not published
 * there either.
 */
export const SKILLS_HTTP_SURFACE: CallSurface = 'mcp';

/**
 * The surface a skill surface serves: the one its MCP handler context carries, else the surface of
 * the call the code runs in (a tool call, a resource read, a completion).
 */
function callerSurface(ctx: unknown, surface: CallSurface | undefined): CallSurface | undefined {
  return surface ?? callSurfaceOf(ctx) ?? getCallSurface();
}

type SkillFilterScope = Pick<ScopeEntry, 'runFlowForOutput'>;

type SkillDiscoveryScope = SkillFilterScope &
  Pick<ScopeEntry, 'authoritiesEngine' | 'authoritiesContextBuilder' | 'authoritiesScopeMapping'>;

/**
 * The skills, in their order, that the current caller may see: those `availableWhen` offers to the
 * caller (its `surface` and every process-wide axis: `os`, `runtime`, `env`, ...), less any the
 * `skills:filter` flow drops.
 *
 * Every skill surface goes through here, so each applies the same availability rule, whatever list
 * it starts from (a registry listing, a search index, a name).
 *
 * `ctx` is the MCP handler context (`{ authInfo }`) of a surface that runs outside a flow, so the
 * filter judges that caller. Surfaces already inside a flow (resource reads, tool calls, HTTP) omit it.
 * `surface` overrides the caller's surface (the HTTP endpoints pass {@link SKILLS_HTTP_SURFACE}).
 */
export async function filterServableSkills<T extends SkillEntry>(
  scope: SkillFilterScope,
  skills: readonly T[],
  ctx?: unknown,
  surface?: CallSurface,
): Promise<T[]> {
  const caller = callerSurface(ctx, surface);
  const offered = skills.filter((skill) => availabilityForCall(skill.metadata.availableWhen, caller) === 'available');
  if (offered.length === 0) return [];
  const { skills: servable } = await scope.runFlowForOutput('skills:filter', { skills: [...offered], ctx });
  const servableSkills = new Set<SkillEntry>(servable);
  return offered.filter((skill) => servableSkills.has(skill));
}

/** Whether the current caller may see or load this skill (see {@link filterServableSkills}). */
export async function isSkillServable(
  scope: SkillFilterScope,
  skill: SkillEntry,
  ctx?: unknown,
  surface?: CallSurface,
): Promise<boolean> {
  const servable = await filterServableSkills(scope, [skill], ctx, surface);
  return servable.length === 1;
}

/** The caller a discovery surface filters for. */
export interface SkillDiscoveryCaller {
  /** Request AuthInfo the skill authorities are evaluated against. */
  authInfo?: Record<string, unknown>;
  /** The MCP handler context, for a surface that runs outside a flow (see {@link filterServableSkills}). */
  ctx?: unknown;
  /** The caller's surface, when neither `ctx` nor the call being served carries it (the HTTP endpoints). */
  surface?: CallSurface;
}

/**
 * Filter search or list results, whose projected metadata only carries an id and name, down to the
 * skills the caller may discover. Each result is resolved to its registered entry once, and the skill
 * authorities and then the `skills:filter` flow judge that same entry. Results without a registered
 * entry (external skills) are kept, as they carry no metadata a gate could judge.
 */
export async function filterDiscoverableSkillResults<T extends { metadata: { id?: string; name: string } }>(
  scope: SkillDiscoveryScope,
  registry: SkillEntryLookup,
  results: readonly T[],
  caller: SkillDiscoveryCaller = {},
): Promise<T[]> {
  const resolve = createSkillEntryResolver(registry);
  const entries = results.map((result) => resolve(skillResultId(result)));
  const registered = [...new Set(entries.filter((entry): entry is SkillEntry => entry !== undefined))];
  const authorized = await filterSkillsByAuthorities(scope, registered, caller.authInfo ?? {});
  const servable = new Set<SkillEntry>(await filterServableSkills(scope, authorized, caller.ctx, caller.surface));
  return results.filter((_, index) => {
    const entry = entries[index];
    return entry === undefined || servable.has(entry);
  });
}

/** The part of a tool registry a skill load needs to judge its tools' `availableWhen.surface`. */
export interface SkillToolLookup {
  getTools(includeHidden?: boolean): ReadonlyArray<{ name: string; metadata?: { availableWhen?: EntryAvailability } }>;
}

/**
 * A loaded skill's tools as the current caller sees them (the caller's surface is resolved as in
 * {@link filterServableSkills}). A tool `availableWhen.surface` doesn't offer the caller is one
 * `tools/list` leaves out and `tools/call` answers as unknown, so it is reported as missing, as a
 * tool that doesn't exist is, and neither its availability nor its schema reaches that caller.
 */
export function skillToolsForCaller<
  T extends {
    availableTools: string[];
    missingTools: string[];
    isComplete: boolean;
    warning?: string;
    skill?: { name?: string };
  },
>(loaded: T, tools: SkillToolLookup | null | undefined, ctx?: unknown, surface?: CallSurface): T {
  const caller = callerSurface(ctx, surface);
  if (!tools || caller === undefined || loaded.availableTools.length === 0) return loaded;
  const availability = new Map(tools.getTools(true).map((tool) => [tool.name, tool.metadata?.availableWhen]));
  const notOffered = loaded.availableTools.filter((name) => !isOfferedOnSurface(availability.get(name), caller));
  if (notOffered.length === 0) return loaded;
  return {
    ...loaded,
    availableTools: loaded.availableTools.filter((name) => !notOffered.includes(name)),
    missingTools: [...loaded.missingTools, ...notOffered],
    isComplete: false,
    warning: warningWithMissingTools(loaded.warning, loaded.skill?.name, notOffered),
  };
}

const WARNING_PREFIX = /^Skill "(.*)" references /;
const WARNING_SUFFIX = '. Some functionality may be limited.';
const MISSING_PART = 'missing tools: ';

/**
 * The load warning with `names` among its missing tools, in `SkillToolValidator.formatWarning`'s
 * shape (`Skill "<name>" references missing tools: a, b; hidden tools: c. Some functionality may be
 * limited.`). A tool the caller's surface hides is reported as missing, like a tool that doesn't exist.
 */
function warningWithMissingTools(warning: string | undefined, skillName: string | undefined, names: string[]): string {
  const prefix = warning?.match(WARNING_PREFIX);
  if (warning && prefix && warning.endsWith(WARNING_SUFFIX)) {
    const parts = warning.slice(prefix[0].length, -WARNING_SUFFIX.length).split('; ');
    const missing = parts.findIndex((part) => part.startsWith(MISSING_PART));
    if (missing === -1) parts.unshift(`${MISSING_PART}${names.join(', ')}`);
    else parts[missing] = `${parts[missing]}, ${names.join(', ')}`;
    return `${prefix[0]}${parts.join('; ')}${WARNING_SUFFIX}`;
  }
  const sentence = `Skill "${skillName ?? 'skill'}" references ${MISSING_PART}${names.join(', ')}${WARNING_SUFFIX}`;
  return warning ? `${warning} ${sentence}` : sentence;
}
