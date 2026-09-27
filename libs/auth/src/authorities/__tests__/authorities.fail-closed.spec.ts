import { AuthoritiesEngine } from '../authorities.engine';
import { AuthoritiesEvaluatorRegistry, AuthoritiesProfileRegistry } from '../authorities.registry';
import type {
  AuthoritiesEvaluationContext,
  AuthoritiesMetadata,
  AuthoritiesPolicyMetadata,
  AuthorityGuardFn,
} from '../authorities.types';
import { findAuthoritiesRuleProblems } from '../authorities.validation';

const anonymous: AuthoritiesEvaluationContext = {
  user: { sub: undefined, roles: [], permissions: [], claims: {} },
  input: {},
  env: {},
  relationships: { check: async () => false },
};

function engineWith(profiles: Record<string, unknown> = {}): AuthoritiesEngine {
  const registry = new AuthoritiesProfileRegistry();
  registry.registerAll(profiles as Record<string, AuthoritiesPolicyMetadata>);
  return new AuthoritiesEngine(registry, new AuthoritiesEvaluatorRegistry());
}

/** Rules that check nothing, or not what they look like they check (#266). */
const rulesThatCheckNothing: Array<[string, unknown]> = [
  ['an empty rule', {}],
  ['roles with neither all nor any', { roles: {} }],
  ['an empty roles.all', { roles: { all: [] } }],
  ['a misspelled field', { role: { any: ['admin'] } }],
  ['a misspelled roles.all', { roles: { any: ['admin'], al: ['owner'] } }],
  ['an empty allOf', { allOf: [] }],
  ['an empty anyOf', { anyOf: [] }],
  ['a profile name inside anyOf', { anyOf: ['admin'] }],
  ['an empty rule inside not', { not: {} }],
  ['an empty rule inside allOf', { allOf: [{}] }],
  ['only an operator', { operator: 'OR' }],
  ['a lowercase operator', { operator: 'and', roles: { any: ['admin'] }, permissions: { any: ['x'] } }],
  ['empty attributes', { attributes: {} }],
  ['an empty attributes.match', { attributes: { match: {} } }],
  ['empty attributes.conditions', { attributes: { conditions: [] } }],
  ['an unknown attributes operator', { attributes: { conditions: [{ path: 'user.sub', op: 'equals', value: 1 }] } }],
  ['empty relationships', { relationships: [] }],
  ['an incomplete relationship', { relationships: { type: 'owner', resource: 'ticket' } }],
  ['empty custom', { custom: {} }],
  ['empty guards', { guards: [] }],
  ['a guard that is not a function', { guards: ['admin'] }],
  ['an empty list of profiles', []],
  ['an empty profile name', ''],
  ['a number', 42],
  ['null', null],
];

describe('authorities rules that check nothing (#266)', () => {
  it.each(rulesThatCheckNothing)('denies %s at evaluation time', async (_label, rule) => {
    const result = await engineWith({ admin: { roles: { any: ['admin'] } } }).evaluate(
      rule as AuthoritiesMetadata,
      anonymous,
    );

    expect(result.granted).toBe(false);
    expect(result.deniedBy).toMatch(/^invalid authorities rule: /);
  });

  it.each(rulesThatCheckNothing)('reports %s as a problem', (_label, rule) => {
    expect(findAuthoritiesRuleProblems(rule).length).toBeGreaterThan(0);
  });

  it('denies a profile that checks nothing', async () => {
    const result = await engineWith({ open: {} }).evaluate('open', anonymous);

    expect(result).toMatchObject({ granted: false, deniedBy: expect.stringMatching(/invalid authorities rule/) });
  });

  it('reports the profiles that check nothing', () => {
    expect(engineWith({ open: {}, admin: { roles: { any: ['admin'] } } }).findProfileProblems()).toEqual([
      'profile "open": checks nothing',
    ]);
  });

  it('names the problem and where it is', () => {
    expect(
      findAuthoritiesRuleProblems({
        role: { any: ['admin'] },
        roles: {},
        allOf: [{ permissions: { all: [] } }],
        not: {},
      }),
    ).toEqual([
      'has an unknown field "role"',
      '.roles needs "all" or "any"',
      '.allOf[0].permissions.all is empty',
      '.not checks nothing',
    ]);
  });

  it.each<[string, AuthoritiesMetadata]>([
    ['a profile name', 'admin'],
    ['a list of profile names', ['admin']],
    ['roles', { roles: { any: ['admin'] } }],
    ['permissions', { permissions: { all: ['tickets:write'] } }],
    [
      'attributes',
      { attributes: { match: { 'user.sub': 'ada' }, conditions: [{ path: 'user.sub', op: 'exists', value: true }] } },
    ],
    ['relationships', { relationships: { type: 'owner', resource: 'ticket', resourceId: { fromInput: 'id' } } }],
    ['custom', { custom: { ipAllowList: { cidr: ['10.0.0.0/8'] } } }],
    ['guards', { guards: [() => true] }],
    [
      'combinators',
      { operator: 'OR', anyOf: [{ roles: { any: ['a'] } }], allOf: [{ not: { roles: { any: ['b'] } } }] },
    ],
  ])('accepts a rule with %s', (_label, rule) => {
    expect(findAuthoritiesRuleProblems(rule)).toEqual([]);
  });
});

/** ABAC conditions whose expected value is missing or of a type the operator can never compare against. */
const malformedConditions: Array<[string, Record<string, unknown>]> = [
  ['exists with no value', { path: 'user.sub', op: 'exists' }],
  ['exists with value undefined', { path: 'user.sub', op: 'exists', value: undefined }],
  ['exists with a non-boolean value', { path: 'user.sub', op: 'exists', value: 'yes' }],
  ['exists with a reference', { path: 'user.sub', op: 'exists', value: { fromInput: 'present' } }],
  ['neq with no value', { path: 'user.sub', op: 'neq' }],
  ['eq with no value', { path: 'user.sub', op: 'eq' }],
  ['notIn with no value', { path: 'user.sub', op: 'notIn' }],
  ['notIn with an empty list', { path: 'user.sub', op: 'notIn', value: [] }],
  ['in with a string', { path: 'user.sub', op: 'in', value: 'ada' }],
  ['gt with a string', { path: 'claims.level', op: 'gt', value: '3' }],
  ['startsWith with a number', { path: 'user.sub', op: 'startsWith', value: 1 }],
  ['matches with no value', { path: 'user.sub', op: 'matches' }],
  ['a reference with an empty name', { path: 'user.sub', op: 'eq', value: { fromInput: '' } }],
  ['a reference with two sources', { path: 'user.sub', op: 'eq', value: { fromInput: 'a', fromClaims: 'b' } }],
];

describe('ABAC conditions without a usable value', () => {
  it.each(malformedConditions)('denies %s at evaluation time', async (_label, condition) => {
    const result = await engineWith().evaluate(
      { attributes: { conditions: [condition] } } as unknown as AuthoritiesMetadata,
      anonymous,
    );

    expect(result.granted).toBe(false);
    expect(result.deniedBy).toMatch(/^invalid authorities rule: /);
  });

  it.each(malformedConditions)('reports %s as a problem', (_label, condition) => {
    expect(findAuthoritiesRuleProblems({ attributes: { conditions: [condition] } })).not.toEqual([]);
  });

  it('denies exists with no value, which admitted every caller without the attribute', async () => {
    const result = await engineWith().evaluate(
      { attributes: { conditions: [{ path: 'user.sub', op: 'exists' }] } } as unknown as AuthoritiesMetadata,
      anonymous,
    );

    expect(result.granted).toBe(false);
  });

  it('denies a condition with no value under not, which turned its failure into a grant', async () => {
    const result = await engineWith().evaluate(
      { not: { attributes: { conditions: [{ path: 'user.sub', op: 'eq' }] } } } as unknown as AuthoritiesMetadata,
      anonymous,
    );

    expect(result.granted).toBe(false);
  });

  it('names the condition and what its value needs', () => {
    expect(
      findAuthoritiesRuleProblems({
        attributes: {
          conditions: [
            { path: 'user.sub', op: 'exists' },
            { path: 'user.sub', op: 'in', value: 'ada' },
          ],
        },
      }),
    ).toEqual([
      '.attributes.conditions[0].value is missing',
      '.attributes.conditions[1].value must be a list for "in"',
    ]);
  });

  it('reports a match entry with no value', () => {
    expect(findAuthoritiesRuleProblems({ attributes: { match: { 'user.sub': undefined } } })).toEqual([
      '.attributes.match["user.sub"] has no value',
    ]);
  });

  it.each<[string, Record<string, unknown>]>([
    ['exists: false', { path: 'user.sub', op: 'exists', value: false }],
    ['eq: null', { path: 'claims.org', op: 'eq', value: null }],
    ['neq with a reference', { path: 'claims.org', op: 'neq', value: { fromClaims: 'home_org' } }],
    ['in with a list', { path: 'env.NODE_ENV', op: 'in', value: ['staging', 'production'] }],
    ['in with a reference', { path: 'user.sub', op: 'in', value: { fromInput: 'allowed' } }],
    ['gte with a number', { path: 'claims.level', op: 'gte', value: 3 }],
    ['contains with a string', { path: 'claims.groups', op: 'contains', value: 'ops' }],
    ['matches with a pattern', { path: 'user.sub', op: 'matches', value: '^svc-' }],
  ])('accepts a condition with %s', (_label, condition) => {
    expect(findAuthoritiesRuleProblems({ attributes: { conditions: [condition] } })).toEqual([]);
  });
});

describe('guards (#267)', () => {
  it.each<[string, unknown]>([
    ['undefined', undefined],
    ['null', null],
    ['0', 0],
    ['1', 1],
    ['an object', { granted: false }],
    ['an empty string', ''],
  ])('refuse when a guard returns %s', async (_label, value) => {
    const guard = (() => value) as unknown as AuthorityGuardFn;

    const result = await engineWith().evaluate({ guards: [guard] }, anonymous);

    expect(result.granted).toBe(false);
    expect(result.deniedBy).toMatch(/^guards\[0\]: /);
  });

  it('refuse when an async guard forgets to return', async () => {
    const guard = (async () => {
      await Promise.resolve();
    }) as unknown as AuthorityGuardFn;

    const result = await engineWith().evaluate({ guards: [guard] }, anonymous);

    expect(result.granted).toBe(false);
  });

  it('admit only when every guard returns true', async () => {
    const result = await engineWith().evaluate({ guards: [() => true, async () => true] }, anonymous);

    expect(result.granted).toBe(true);
  });
});
