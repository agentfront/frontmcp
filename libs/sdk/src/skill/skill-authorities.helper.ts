// file: libs/sdk/src/skill/skill-authorities.helper.ts

/**
 * Skill authorities enforcement helpers.
 *
 * Mirrors the tool/resource enforcement pattern (`checkEntryAuthorities` for
 * single-entry deny and `filterByAuthorities` for discovery filtering) for the
 * `@Skill({ authorities })` metadata field. Because skills are served across
 * several surfaces (MCP `skills/load` + `skills/search` flows, SEP-2640
 * `skill://` resources, and the HTTP `/skills` API), the deny/filter logic is
 * centralised here so every surface enforces the same policy.
 *
 * Behaviour preserved from the rest of the framework:
 *   - When no authorities engine + context builder is configured on the scope,
 *     every check is a no-op (skills behave exactly as before).
 *   - Skills WITHOUT an `authorities` field are never gated.
 *
 * Discovery filtering ({@link filterSkillsByAuthorities}) evaluates policies
 * WITHOUT request input — `fromInput`/ReBAC-by-input conditions cannot be
 * evaluated at list time, mirroring the tool/resource list flows. Skill
 * authorities meant for discovery filtering should be role/permission/claims
 * based.
 */

import type { ScopeEntry, SkillEntry } from '../common';
import type { SkillRegistryInterface } from './skill.registry';

/** Minimal duck-typed surface of the scope we rely on for authorities. */
type AuthoritiesScopeView = Pick<
  ScopeEntry,
  'authoritiesEngine' | 'authoritiesContextBuilder' | 'authoritiesScopeMapping'
>;

/**
 * Normalise the request AuthInfo so the authorities context builder can read
 * claims from `authInfo.user`.
 *
 * Skills are enforced from surfaces that receive the **raw transport AuthInfo**
 * (`{ token, clientId, scopes, extra: { user, sessionId } }`) — namely the
 * SEP-2640 `skill://` resources and the `skills/*` MCP handlers. The shared
 * `AuthoritiesContextBuilder.build()` reads `authInfo.user`, which the
 * tool/resource FLOWS already receive lifted to the top level. To match that
 * behaviour without changing the shared builder, lift `extra.user` to
 * `authInfo.user` when the top-level `user` is absent. Already-normalised
 * AuthInfo (with a top-level `user`) is returned unchanged.
 */
export function normalizeAuthInfoForAuthorities(authInfo: Record<string, unknown>): Record<string, unknown> {
  if (authInfo['user']) return authInfo;
  const extra = authInfo['extra'] as Record<string, unknown> | undefined;
  const extraUser = extra?.['user'];
  if (extraUser) return { ...authInfo, user: extraUser };
  return authInfo;
}

/**
 * Read the `authorities` metadata declared on a skill entry, if any.
 * Returns undefined for skills that do not declare authorities.
 */
export function getSkillAuthorities(skill: SkillEntry): import('@frontmcp/auth').AuthoritiesMetadata | undefined {
  const metadata = skill.metadata as unknown as Record<string, unknown>;
  const authorities = metadata['authorities'];
  return authorities as import('@frontmcp/auth').AuthoritiesMetadata | undefined;
}

/**
 * Assert that the caller is authorized to load/read the given skill.
 *
 * Mirrors `checkEntryAuthorities` for tools/resources: throws
 * `AuthorityDeniedError` (MCP code -32003) when the skill declares
 * `authorities` and the caller's claims do not satisfy the policy.
 *
 * No-op (resolves) when:
 *   - no authorities engine/context builder is configured, or
 *   - the skill declares no `authorities`.
 *
 * @param scope    The active scope (provides engine/context builder/scopeMapping).
 * @param skill    The skill entry being loaded/read.
 * @param authInfo Request AuthInfo (claims, roles, permissions).
 * @param input    Optional request input for ABAC/ReBAC `fromInput` conditions.
 */
export async function assertSkillAuthorized(
  scope: AuthoritiesScopeView,
  skill: SkillEntry,
  authInfo: Record<string, unknown>,
  input: Record<string, unknown> = {},
): Promise<void> {
  const engine = scope.authoritiesEngine;
  const ctxBuilder = scope.authoritiesContextBuilder;
  if (!engine || !ctxBuilder) return;

  const authorities = getSkillAuthorities(skill);
  if (!authorities) return;

  const evalCtx = ctxBuilder.build(normalizeAuthInfoForAuthorities(authInfo), input);
  const result = await engine.evaluate(authorities, evalCtx);
  if (result.granted) return;

  // Resolve required scopes from scopeMapping when available (matches tools).
  let requiredScopes: string[] | undefined;
  const scopeMapping = scope.authoritiesScopeMapping;
  if (scopeMapping && result.denial) {
    const { resolveRequiredScopes } = await import('@frontmcp/auth');
    requiredScopes = resolveRequiredScopes(result.denial, scopeMapping, authorities);
  }

  const { AuthorityDeniedError } = await import('@frontmcp/auth');
  throw new AuthorityDeniedError({
    entryType: 'Skill',
    entryName: skill.fullName || skill.name,
    deniedBy: result.deniedBy ?? 'policy denied',
    denial: result.denial,
    requiredScopes,
  });
}

/**
 * Filter a list of skill entries down to those the caller is authorized to
 * discover. Mirrors `filterByAuthorities` for tools/resources.
 *
 * Skills without `authorities` always pass. When no engine/context builder is
 * configured the list is returned unchanged.
 *
 * Evaluated WITHOUT request input: `fromInput`/ReBAC-by-input policies cannot
 * be evaluated during discovery and will therefore be treated as a denial when
 * they reference request input that is absent. Use role/permission/claims-based
 * authorities for skills that must remain discoverable.
 *
 * @param scope    The active scope (provides engine/context builder).
 * @param skills   The candidate skill entries.
 * @param authInfo Request AuthInfo (claims, roles, permissions).
 * @returns The subset of skills the caller is authorized to see.
 */
export async function filterSkillsByAuthorities<T extends SkillEntry>(
  scope: AuthoritiesScopeView,
  skills: readonly T[],
  authInfo: Record<string, unknown>,
): Promise<T[]> {
  const engine = scope.authoritiesEngine;
  const ctxBuilder = scope.authoritiesContextBuilder;
  if (!engine || !ctxBuilder) return [...skills];

  // Evaluate each skill's policy (without request input) in parallel, keeping
  // the boolean grant per index so we can filter the original typed array and
  // preserve the element type `T`.
  const normalized = normalizeAuthInfoForAuthorities(authInfo);
  const grants = await Promise.all(
    skills.map(async (skill): Promise<boolean> => {
      const authorities = getSkillAuthorities(skill);
      if (!authorities) return true;
      const evalCtx = ctxBuilder.build(normalized);
      const result = await engine.evaluate(authorities, evalCtx);
      return result.granted;
    }),
  );

  return skills.filter((_, i) => grants[i]);
}

/**
 * Filter discovery results whose projected metadata only carries an id/name
 * (e.g. `skills/search` / `skills/list` MCP responses, or HTTP search results)
 * down to the skills the caller is authorized to see.
 *
 * Search/list metadata is projected from `SkillContent` and does NOT carry the
 * `authorities` field, so we resolve the live skill entry by id/name to read
 * its declared authorities, then evaluate via the scope's engine. No-op when no
 * authorities engine is configured (results returned unchanged), and items
 * whose backing entry can't be resolved are kept (treated as ungated).
 *
 * Evaluated WITHOUT request input — see {@link filterSkillsByAuthorities}.
 */
export async function filterSkillMetadataByAuthorities<T extends { metadata: { id?: string; name: string } }>(
  scope: AuthoritiesScopeView,
  registry: SkillRegistryInterface,
  results: readonly T[],
  authInfo: Record<string, unknown>,
): Promise<T[]> {
  const engine = scope.authoritiesEngine;
  const ctxBuilder = scope.authoritiesContextBuilder;
  if (!engine || !ctxBuilder) return [...results];

  const normalized = normalizeAuthInfoForAuthorities(authInfo);
  const grants = await Promise.all(
    results.map(async (r): Promise<boolean> => {
      const id = r.metadata.id ?? r.metadata.name;
      const entry =
        registry.findByName(id) ??
        registry.getSkills(true).find((s) => (s.metadata.id ?? s.name) === id || s.metadata.name === id);
      if (!entry) return true;
      const authorities = getSkillAuthorities(entry);
      if (!authorities) return true;
      const evalCtx = ctxBuilder.build(normalized);
      const result = await engine.evaluate(authorities, evalCtx);
      return result.granted;
    }),
  );

  return results.filter((_, i) => grants[i]);
}
