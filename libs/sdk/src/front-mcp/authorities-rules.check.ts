import type { AuthoritiesEngine } from '@frontmcp/auth';

import { AuthConfigurationError } from '../errors';

/** An entry that declares `authorities`, labelled for startup errors. */
export interface EntryAuthorities {
  label: string;
  authorities: unknown;
}

/**
 * Throw `AuthConfigurationError` when a profile or an entry's rule is malformed, checks nothing, or
 * names a profile the engine does not have.
 */
export function assertAuthoritiesRules(engine: AuthoritiesEngine, entries: readonly EntryAuthorities[]): void {
  const problems = [
    ...engine.findProfileProblems(),
    ...entries.flatMap(({ label, authorities }) =>
      engine
        .findRuleProblems(authorities)
        .map((problem) => `${label}: authorities${problem.startsWith('.') ? '' : ' '}${problem}`),
    ),
  ];
  if (problems.length === 0) return;
  const suffix = problems.length > 5 ? `; and ${problems.length - 5} more` : '';
  throw new AuthConfigurationError(`Invalid authorities rule: ${problems.slice(0, 5).join('; ')}${suffix}`, {
    errors: problems,
    suggestion:
      'Every rule must check something (roles, permissions, attributes, relationships, custom, guards, ' +
      'allOf, anyOf or not) with known fields and no empty lists. To leave an entry open, remove its authorities.',
  });
}

/**
 * Fail-fast at startup, so an entry never looks protected while anyone can use it: throw `AuthConfigurationError`
 * when entries declare `authorities` that no engine enforces, or when a rule is malformed (`assertAuthoritiesRules`).
 */
export function assertEntryAuthorities(
  engine: AuthoritiesEngine | undefined,
  contextBuilder: unknown,
  entries: readonly EntryAuthorities[],
): void {
  if (engine && contextBuilder) {
    assertAuthoritiesRules(engine, entries);
    return;
  }
  if (entries.length === 0) return;
  const names = entries
    .slice(0, 5)
    .map((entry) => entry.label)
    .join(', ');
  const suffix = entries.length > 5 ? ` and ${entries.length - 5} more` : '';
  throw new AuthConfigurationError(
    `Authorities configuration required: ${names}${suffix} declare 'authorities' metadata ` +
      `but authorities enforcement is not fully configured (engine/context builder missing). ` +
      `Add 'authorities: { claimsMapping: {...}, profiles: {...} }' ` +
      `to your @FrontMcp() decorator to enable enforcement, or remove 'authorities' from entry metadata.`,
    { suggestion: 'Add authorities config to @FrontMcp() or remove authorities from entry metadata' },
  );
}
