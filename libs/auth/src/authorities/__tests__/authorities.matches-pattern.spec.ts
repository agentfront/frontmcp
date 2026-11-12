import { AuthoritiesEngine } from '../authorities.engine';
import { evaluateAbac } from '../authorities.evaluator';
import { AuthoritiesEvaluatorRegistry, AuthoritiesProfileRegistry } from '../authorities.registry';
import type { AuthoritiesEvaluationContext, AuthoritiesPolicyMetadata } from '../authorities.types';
import { findAuthoritiesRuleProblems } from '../authorities.validation';

function callerWith(input: Record<string, unknown>, name = 'ab'): AuthoritiesEvaluationContext {
  return {
    user: { sub: 'user-1', roles: [], permissions: [], claims: { name } },
    input,
    env: {},
    relationships: { check: async () => false },
  };
}

const nameMatchesInputPattern: AuthoritiesPolicyMetadata = {
  attributes: { conditions: [{ path: 'claims.name', op: 'matches', value: { fromInput: 'pattern' } }] },
};

function evaluate(policy: AuthoritiesPolicyMetadata, ctx: AuthoritiesEvaluationContext) {
  return new AuthoritiesEngine(new AuthoritiesProfileRegistry(), new AuthoritiesEvaluatorRegistry()).evaluate(
    policy,
    ctx,
  );
}

describe('the matches operator', () => {
  it.each([
    ['nested repetition', '(a+)+$'],
    ['overlapping alternatives', '^(a|a)*$'],
    ['a syntax error', '[unclosed'],
    ['more than 256 characters', `^${'a'.repeat(300)}$`],
  ])('denies not around a pattern from the input with %s, without running it', async (_label, pattern) => {
    const result = await evaluate({ not: nameMatchesInputPattern }, callerWith({ pattern }));

    expect(result.granted).toBe(false);
    expect(result.unresolved).toBe(true);
    expect(result.deniedBy).toMatch(/^attributes\.conditions: 'claims\.name' could not be checked: the pattern /);
  });

  it('denies a value longer than 10000 characters as unresolved', () => {
    const result = evaluateAbac(
      { conditions: [{ path: 'claims.name', op: 'matches', value: '^a+$' }] },
      callerWith({}, 'a'.repeat(10_001)),
    );

    expect(result.granted).toBe(false);
    expect(result.unresolved).toBe(true);
    expect(result.deniedBy).toBe(
      "attributes.conditions: 'claims.name' could not be checked: the value is longer than 10000 characters",
    );
  });

  it('still matches a pattern from the input that runs in bounded time', async () => {
    const result = await evaluate(nameMatchesInputPattern, callerWith({ pattern: '^a+b$' }));

    expect(result.granted).toBe(true);
  });

  it('reports a literal pattern with nested repetition when the server starts', () => {
    const problems = findAuthoritiesRuleProblems({
      attributes: { conditions: [{ path: 'claims.name', op: 'matches', value: '(a+)+$' }] },
    });

    expect(problems).toEqual([
      '.attributes.conditions[0].value cannot be used: the pattern is not a valid regular expression, ' +
        'or its matching time can grow very fast with the value',
    ]);
  });
});
