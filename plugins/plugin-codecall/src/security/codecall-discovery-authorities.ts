// file: plugins/plugin-codecall/src/security/codecall-discovery-authorities.ts

/**
 * The caller's `authorities` applied to what CodeCall's discovery returns (search, describe, a script's `getTool`,
 * the skill searches), as `tools/list` and the skill listings apply them: without request input, and an entry whose
 * policy fails to answer is withheld. Without an authorities engine nothing is withheld.
 */

/** The part of a scope that evaluates `authorities`, and lists its tools. */
interface AuthoritiesScope {
  authoritiesEngine?: { evaluate(authorities: unknown, context: unknown): Promise<{ granted: boolean }> };
  authoritiesContextBuilder?: { build(authInfo: Record<string, unknown>): unknown };
  tools?: { getTools?(includeHidden?: boolean): ReadonlyArray<{ name: string; fullName: string; metadata?: unknown }> };
}

/** Whether an entry's `authorities` let the caller discover it; true when it declares none. */
async function isDiscoverable(
  scope: AuthoritiesScope,
  metadata: unknown,
  authInfo: Record<string, unknown>,
): Promise<boolean> {
  const authorities = (metadata as { authorities?: unknown } | undefined)?.authorities;
  const engine = scope.authoritiesEngine;
  const contextBuilder = scope.authoritiesContextBuilder;
  if (!authorities || !engine || !contextBuilder) return true;
  try {
    return (await engine.evaluate(authorities, contextBuilder.build(authInfo))).granted;
  } catch {
    return false;
  }
}

/** The names and full names of the scope's tools whose `authorities` withhold them from this caller. */
export async function toolsWithheldByAuthorities(scope: unknown, authInfo: unknown): Promise<Set<string>> {
  const authoritiesScope = (scope ?? {}) as AuthoritiesScope;
  const withheld = new Set<string>();
  if (!authoritiesScope.authoritiesEngine || !authoritiesScope.authoritiesContextBuilder) return withheld;
  const callerAuthInfo = (authInfo ?? {}) as Record<string, unknown>;
  for (const tool of authoritiesScope.tools?.getTools?.(true) ?? []) {
    if (await isDiscoverable(authoritiesScope, tool.metadata, callerAuthInfo)) continue;
    withheld.add(tool.name);
    withheld.add(tool.fullName);
  }
  return withheld;
}

/** The skills whose `authorities` let this caller discover them, read with `extra.user` as `user`, as skill listings do. */
export async function skillsDiscoverableByAuthorities<T extends { metadata: unknown }>(
  scope: unknown,
  skills: readonly T[],
  authInfo: unknown,
): Promise<T[]> {
  const callerAuthInfo = (authInfo ?? {}) as Record<string, unknown>;
  const extraUser = (callerAuthInfo['extra'] as Record<string, unknown> | undefined)?.['user'];
  const normalized = callerAuthInfo['user'] || !extraUser ? callerAuthInfo : { ...callerAuthInfo, user: extraUser };
  const grants = await Promise.all(
    skills.map((skill) => isDiscoverable((scope ?? {}) as AuthoritiesScope, skill.metadata, normalized)),
  );
  return skills.filter((_skill, index) => grants[index]);
}
