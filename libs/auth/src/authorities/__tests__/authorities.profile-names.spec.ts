import { AuthoritiesEngine } from '../authorities.engine';
import { AuthoritiesEvaluatorRegistry, AuthoritiesProfileRegistry } from '../authorities.registry';
import type { AuthoritiesPolicyMetadata } from '../authorities.types';

function engineWith(profiles: Record<string, AuthoritiesPolicyMetadata>): AuthoritiesEngine {
  const registry = new AuthoritiesProfileRegistry();
  registry.registerAll(profiles);
  return new AuthoritiesEngine(registry, new AuthoritiesEvaluatorRegistry());
}

/**
 * A profile name an entry uses must name a registered profile, so the server can refuse
 * `authorities: 'admn'` when it starts instead of refusing every caller at run time.
 */
describe('AuthoritiesEngine.findRuleProblems: profile names', () => {
  const engine = engineWith({ admin: { roles: { any: ['admin'] } }, support: { roles: { any: ['support'] } } });

  it('reports a profile name that no profile has', () => {
    expect(engine.findRuleProblems('admn')).toEqual(['names an unknown profile "admn"']);
  });

  it('reports each unknown name in a list of profiles', () => {
    expect(engine.findRuleProblems(['admin', 'admn', 'suport'])).toEqual([
      'names an unknown profile "admn"',
      'names an unknown profile "suport"',
    ]);
  });

  it('accepts names of registered profiles', () => {
    expect(engine.findRuleProblems('admin')).toEqual([]);
    expect(engine.findRuleProblems(['admin', 'support'])).toEqual([]);
  });

  it('does not look up a name inside a combinator (it is not a rule object)', () => {
    expect(engine.findRuleProblems({ anyOf: ['admin'] })).toEqual([
      '.anyOf[0] must be a rule object, not a profile name',
    ]);
  });

  it('leaves the structural problems of an empty name or list as they were', () => {
    expect(engine.findRuleProblems('')).toEqual(['the profile name is empty']);
    expect(engine.findRuleProblems([])).toEqual(['the list of profiles is empty']);
  });
});
