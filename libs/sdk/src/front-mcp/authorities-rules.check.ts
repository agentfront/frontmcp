import {
  AuthoritiesEngine,
  AuthoritiesEvaluatorRegistry,
  AuthoritiesProfileRegistry,
  type AuthoritiesEvaluator,
  type AuthoritiesPolicyMetadata,
} from '@frontmcp/auth';

import { AuthConfigurationError } from '../errors';

/** An entry that declares `authorities`, labelled for startup errors. */
export interface EntryAuthorities {
  label: string;
  authorities: unknown;
}

/** The authorities engine for `@FrontMcp({ authorities })`: its `profiles` and `evaluators`. */
export function createAuthoritiesEngine(config: Record<string, unknown>): AuthoritiesEngine {
  const profileRegistry = new AuthoritiesProfileRegistry();
  if (config['profiles']) {
    profileRegistry.registerAll(config['profiles'] as Record<string, AuthoritiesPolicyMetadata>);
  }
  const evaluatorRegistry = new AuthoritiesEvaluatorRegistry();
  if (config['evaluators']) {
    evaluatorRegistry.registerAll(config['evaluators'] as Record<string, AuthoritiesEvaluator>);
  }
  return new AuthoritiesEngine(profileRegistry, evaluatorRegistry);
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
