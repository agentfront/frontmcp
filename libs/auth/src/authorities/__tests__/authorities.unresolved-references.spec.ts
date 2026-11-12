import { AuthoritiesContextBuilder } from '../authorities.context';
import { AuthoritiesEngine } from '../authorities.engine';
import { evaluateAbac } from '../authorities.evaluator';
import { AuthoritiesEvaluatorRegistry, AuthoritiesProfileRegistry } from '../authorities.registry';
import type {
  AbacOperator,
  AuthoritiesEvaluationContext,
  AuthoritiesEvaluator,
  AuthoritiesMetadata,
  AuthoritiesPolicyMetadata,
  DynamicValueRef,
} from '../authorities.types';

const caller: AuthoritiesEvaluationContext = {
  user: {
    sub: 'user-1',
    roles: ['admin'],
    permissions: [],
    claims: { org: 'org-1', level: 3, groups: ['ops'] },
  },
  input: {},
  env: { SECRET: 's3cr3t-value' },
  relationships: { check: async () => false },
};

function engineWith(
  profiles: Record<string, AuthoritiesPolicyMetadata> = {},
  evaluators: Record<string, AuthoritiesEvaluator> = {},
): AuthoritiesEngine {
  const profileRegistry = new AuthoritiesProfileRegistry();
  profileRegistry.registerAll(profiles);
  const evaluatorRegistry = new AuthoritiesEvaluatorRegistry();
  evaluatorRegistry.registerAll(evaluators);
  return new AuthoritiesEngine(profileRegistry, evaluatorRegistry);
}

function evaluate(policy: AuthoritiesMetadata, ctx: AuthoritiesEvaluationContext = caller) {
  return engineWith().evaluate(policy, ctx);
}

function condition(path: string, op: AbacOperator, value: unknown): AuthoritiesPolicyMetadata {
  return { attributes: { conditions: [{ path, op, value }] } };
}

const missingInput: DynamicValueRef = { fromInput: 'org' };
const missingClaim: DynamicValueRef = { fromClaims: 'blocked_org' };
const orgDiffersFromMissingInput = condition('claims.org', 'neq', missingInput);
const orgEqualsMissingInput = condition('claims.org', 'eq', missingInput);
const isAdmin: AuthoritiesPolicyMetadata = { roles: { any: ['admin'] } };
const isBanned: AuthoritiesPolicyMetadata = { roles: { any: ['banned'] } };

/** Each operator that takes a reference, a path to check, and a value that makes the check hold. */
const operatorCases: Array<[AbacOperator, string, unknown]> = [
  ['eq', 'claims.org', 'org-1'],
  ['neq', 'claims.org', 'org-2'],
  ['in', 'claims.org', ['org-1']],
  ['notIn', 'claims.org', ['org-2']],
  ['gt', 'claims.level', 2],
  ['gte', 'claims.level', 3],
  ['lt', 'claims.level', 4],
  ['lte', 'claims.level', 3],
  ['contains', 'claims.groups', 'ops'],
  ['startsWith', 'claims.org', 'org-'],
  ['endsWith', 'claims.org', '-1'],
  ['matches', 'claims.org', '^org-'],
];

const missingReferences: Array<[string, DynamicValueRef, string]> = [
  ['a missing fromInput', missingInput, "input 'org' is missing"],
  ['a missing fromClaims', missingClaim, "claim 'blocked_org' is missing"],
];

const everyOperatorWithMissingReference = operatorCases.flatMap(([op, path]) =>
  missingReferences.map(([label, reference, reason]) => [op, label, path, reference, reason] as const),
);

describe('a condition whose referenced value is missing', () => {
  it('denies not around neq when the caller omits the input it compares against', async () => {
    const result = await evaluate({ not: orgDiffersFromMissingInput });

    expect(result.granted).toBe(false);
    expect(result.unresolved).toBe(true);
    expect(result.deniedBy).toBe("attributes.conditions: 'claims.org' could not be checked: input 'org' is missing");
  });

  it('denies not around eq when the caller omits the input it compares against', async () => {
    const result = await evaluate({ not: orgEqualsMissingInput });

    expect(result.granted).toBe(false);
    expect(result.unresolved).toBe(true);
  });

  it.each(everyOperatorWithMissingReference)(
    'denies not around %s with %s',
    async (op, _label, path, reference, reason) => {
      const result = await evaluate({ not: condition(path, op, reference) });

      expect(result.granted).toBe(false);
      expect(result.deniedBy).toBe(`attributes.conditions: '${path}' could not be checked: ${reason}`);
    },
  );

  it.each(everyOperatorWithMissingReference)('denies %s with %s as unresolved', (op, _label, path, reference) => {
    const result = evaluateAbac({ conditions: [{ path, op, value: reference }] }, caller);

    expect(result).toEqual({
      granted: false,
      unresolved: true,
      deniedBy: expect.stringContaining('could not be checked'),
      denial: { kind: 'attributes', path: 'attributes.conditions[0]', actual: expect.anything() },
      evaluatedPolicies: ['attributes.conditions'],
    });
  });

  it.each(missingReferences)('denies exists with %s as unresolved', (_label, reference) => {
    const result = evaluateAbac({ conditions: [{ path: 'claims.org', op: 'exists', value: reference }] }, caller);

    expect(result.granted).toBe(false);
    expect(result.unresolved).toBe(true);
  });

  it('denies exists with a reference under not, as a rule that is refused before it runs', async () => {
    const result = await evaluate({ not: condition('claims.org', 'exists', missingInput) });

    expect(result.granted).toBe(false);
    expect(result.deniedBy).toMatch(/^invalid authorities rule: /);
  });

  it.each(missingReferences)('denies not around match with %s', async (_label, reference, reason) => {
    const result = await evaluate({ not: { attributes: { match: { 'claims.org': reference } } } });

    expect(result.granted).toBe(false);
    expect(result.unresolved).toBe(true);
    expect(result.deniedBy).toBe(`attributes.match: 'claims.org' could not be checked: ${reason}`);
  });

  it.each([
    ['fromInput', { fromInput: 'orgId' }],
    ['fromClaims', { fromClaims: 'org_id' }],
  ])('denies not around a relationship whose %s resourceId is missing', async (_label, resourceId) => {
    const result = await evaluate({ not: { relationships: { type: 'blocked', resource: 'org', resourceId } } });

    expect(result.granted).toBe(false);
    expect(result.unresolved).toBe(true);
    expect(result.deniedBy).toBe('relationships: could not resolve resourceId for org');
  });

  it('keeps an env value out of the denial', () => {
    const result = evaluateAbac({ conditions: [{ path: 'env.SECRET', op: 'neq', value: missingInput }] }, caller);

    expect(result.granted).toBe(false);
    expect(JSON.stringify(result)).not.toContain('s3cr3t-value');
  });
});

describe('an unresolved condition inside a composition', () => {
  it.each<[string, AuthoritiesPolicyMetadata]>([
    ['not(not(...))', { not: { not: orgDiffersFromMissingInput } }],
    ['not(not(not(...)))', { not: { not: { not: orgEqualsMissingInput } } }],
    ['not(allOf[granted, unresolved])', { not: { allOf: [isAdmin, orgDiffersFromMissingInput] } }],
    ['not(anyOf[denied, unresolved])', { not: { anyOf: [isBanned, orgEqualsMissingInput] } }],
    ['anyOf[not(unresolved), denied]', { anyOf: [{ not: orgEqualsMissingInput }, isBanned] }],
    ['allOf[granted, not(unresolved)]', { allOf: [isAdmin, { not: orgDiffersFromMissingInput }] }],
    ['not(roles granted AND unresolved attributes)', { not: { ...isAdmin, ...orgDiffersFromMissingInput } }],
    [
      'not(roles denied OR unresolved attributes)',
      { not: { operator: 'OR', ...isBanned, ...orgDiffersFromMissingInput } },
    ],
    ['roles denied OR not(unresolved)', { operator: 'OR', ...isBanned, not: orgEqualsMissingInput }],
    [
      'not(attributes granted AND unresolved in one list)',
      {
        not: {
          attributes: {
            conditions: [
              { path: 'claims.org', op: 'eq', value: 'org-1' },
              { path: 'claims.org', op: 'neq', value: missingInput },
            ],
          },
        },
      },
    ],
    [
      'not(relationships [unresolved, granted])',
      {
        not: {
          relationships: [
            { type: 'blocked', resource: 'org', resourceId: { fromInput: 'orgId' } },
            { type: 'member', resource: 'org', resourceId: 'org-1' },
          ],
        },
      },
    ],
  ])('denies %s', async (_label, policy) => {
    const ctx: AuthoritiesEvaluationContext = {
      ...caller,
      relationships: { check: async (type) => type === 'member' },
    };

    const result = await evaluate(policy, ctx);

    expect(result.granted).toBe(false);
  });

  it.each<[string, AuthoritiesPolicyMetadata]>([
    ['anyOf[unresolved, granted]', { anyOf: [orgEqualsMissingInput, isAdmin] }],
    ['anyOf[not(unresolved), granted]', { anyOf: [{ not: orgDiffersFromMissingInput }, isAdmin] }],
    ['roles granted OR not(unresolved)', { operator: 'OR', ...isAdmin, not: orgEqualsMissingInput }],
    ['not(allOf[denied, unresolved])', { not: { allOf: [isBanned, orgEqualsMissingInput] } }],
    ['not(roles denied AND unresolved attributes)', { not: { ...isBanned, ...orgDiffersFromMissingInput } }],
    [
      'not(attributes denied AND unresolved in one list)',
      {
        not: {
          attributes: {
            conditions: [
              { path: 'claims.org', op: 'neq', value: missingInput },
              { path: 'claims.org', op: 'eq', value: 'org-2' },
            ],
          },
        },
      },
    ],
  ])('grants %s on the branch that resolves', async (_label, policy) => {
    const result = await evaluate(policy);

    expect(result.granted).toBe(true);
  });

  it('reports the unresolved branch when anyOf denies', async () => {
    const result = await evaluate({ anyOf: [isBanned, orgDiffersFromMissingInput] });

    expect(result.granted).toBe(false);
    expect(result.unresolved).toBe(true);
    expect(result.deniedBy).toContain("input 'org' is missing");
  });

  it('reports the plain denial when allOf also holds an unresolved branch', async () => {
    const result = await evaluate({ allOf: [orgDiffersFromMissingInput, isBanned] });

    expect(result.granted).toBe(false);
    expect(result.unresolved).toBeUndefined();
    expect(result.deniedBy).toContain('roles.any');
  });

  it.each<[string, AuthoritiesMetadata]>([
    ['a profile', 'notBlockedOrg'],
    ['a list of profiles', ['admin', 'notBlockedOrg']],
  ])('denies %s whose rule wraps an unresolved condition in not', async (_label, authorities) => {
    const engine = engineWith({ admin: isAdmin, notBlockedOrg: { not: condition('claims.org', 'eq', missingClaim) } });

    const result = await engine.evaluate(authorities, caller);

    expect(result.granted).toBe(false);
    expect(result.unresolved).toBe(true);
    expect(result.deniedBy).toBe(
      "profile:notBlockedOrg: attributes.conditions: 'claims.org' could not be checked: claim 'blocked_org' is missing",
    );
  });

  it('keeps a custom evaluator that reports unresolved a denial under not', async () => {
    const lookup: AuthoritiesEvaluator = {
      name: 'lookup',
      evaluate: async () => ({ granted: false, unresolved: true, evaluatedPolicies: ['custom.lookup'] }),
    };

    const result = await engineWith({}, { lookup }).evaluate({ not: { custom: { lookup: {} } } }, caller);

    expect(result.granted).toBe(false);
  });
});

describe('conditions without references, or whose references resolve', () => {
  it.each(operatorCases)('negates %s on %s with a resolved reference as before', async (op, path, value) => {
    const ctx = { ...caller, input: { value } };
    const check = condition(path, op, { fromInput: 'value' });

    const plain = await evaluate(check, ctx);
    const negated = await evaluate({ not: check }, ctx);

    expect(plain.granted).toBe(true);
    expect(negated.granted).toBe(false);
    expect(negated.unresolved).toBeUndefined();
    expect(negated.deniedBy).toBe('not: inner policy was granted (negated to denied)');
  });

  it.each<[string, AuthoritiesPolicyMetadata]>([
    ["neq the caller's own org", condition('claims.org', 'neq', 'org-1')],
    ['eq on a claim the caller lacks', condition('claims.missing', 'eq', 'x')],
    ['in a list without the claim', condition('claims.org', 'in', ['org-2'])],
    ['eq a resolved reference that differs', condition('claims.org', 'eq', { fromInput: 'org' })],
    ['match on a literal that differs', { attributes: { match: { 'claims.org': 'org-2' } } }],
    ['a relationship the caller lacks', { relationships: { type: 'blocked', resource: 'org', resourceId: 'org-1' } }],
    ['a role the caller lacks', isBanned],
  ])('grants not around %s', async (_label, inner) => {
    const result = await evaluate({ not: inner }, { ...caller, input: { org: 'org-2' } });

    expect(result.granted).toBe(true);
    expect(result.unresolved).toBeUndefined();
  });
});

describe('a check the server is not configured to run', () => {
  const blockedFromOrg: AuthoritiesPolicyMetadata = {
    relationships: { type: 'blocked', resource: 'org', resourceId: 'org-1' },
  };
  const signedIn = { user: { sub: 'user-1' } };

  it('denies not around a relationship when no relationship resolver is configured', async () => {
    const ctx = new AuthoritiesContextBuilder().build(signedIn);

    const result = await evaluate({ not: blockedFromOrg }, ctx);

    expect(result.granted).toBe(false);
    expect(result.unresolved).toBe(true);
    expect(result.deniedBy).toContain('no relationship resolver is configured (set authorities.relationshipResolver)');
  });

  it('grants not around a relationship the configured resolver does not find', async () => {
    const ctx = new AuthoritiesContextBuilder({ relationshipResolver: { check: async () => false } }).build(signedIn);

    const result = await evaluate({ not: blockedFromOrg }, ctx);

    expect(result.granted).toBe(true);
  });

  it('denies not around a custom evaluator that is not registered', async () => {
    const result = await evaluate({ not: { custom: { blocklist: {} } } });

    expect(result.granted).toBe(false);
    expect(result.unresolved).toBe(true);
    expect(result.deniedBy).toBe("custom evaluator 'blocklist' is not registered (add it to authorities.evaluators)");
  });

  it('reports a custom evaluator that is not registered, at any depth, when the server starts', () => {
    const allowlist: AuthoritiesEvaluator = {
      name: 'allowlist',
      evaluate: async () => ({ granted: true, evaluatedPolicies: [] }),
    };
    const engine = engineWith(
      { notBlocked: { anyOf: [isAdmin, { not: { custom: { blocklist: {} } } }] } },
      { allowlist },
    );

    expect(
      engine.findRuleProblems({ allOf: [{ custom: { allowlist: {} } }, { not: { custom: { blocklist: {} } } }] }),
    ).toEqual(['names an unknown custom evaluator "blocklist" (register it in authorities.evaluators)']);
    expect(engine.findRuleProblems({ custom: { allowlist: {} } })).toEqual([]);
    expect(engine.findProfileProblems()).toEqual([
      'profile "notBlocked": names an unknown custom evaluator "blocklist" (register it in authorities.evaluators)',
    ]);
  });
});
