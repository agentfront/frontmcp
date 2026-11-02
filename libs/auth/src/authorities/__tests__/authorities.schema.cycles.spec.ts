import { authoritiesPolicySchema } from '../authorities.schema';

describe('authoritiesPolicySchema with a reference cycle', () => {
  it('accepts a policy that refers to itself, keeping the cycle in the result', () => {
    const policy: Record<string, unknown> = { roles: { any: ['admin'] } };
    policy['anyOf'] = [policy];

    const result = authoritiesPolicySchema.safeParse(policy);

    expect(result.success).toBe(true);
    const parsed = result.data as Record<string, unknown[]>;
    expect(parsed['anyOf'][0]).toBe(parsed);
  });
});
