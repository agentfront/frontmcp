import { MAX_SKILLS_PER_LOAD, SkillsLoadRequestSchema } from '../skills-mcp.types';

describe('SkillsLoadRequestSchema', () => {
  const request = (count: number) => ({
    method: 'skills/load',
    params: { skillIds: Array.from({ length: count }, (_, index) => `skill-${index}`) },
  });

  it(`takes up to ${MAX_SKILLS_PER_LOAD} skill IDs`, () => {
    expect(SkillsLoadRequestSchema.safeParse(request(MAX_SKILLS_PER_LOAD)).success).toBe(true);
  });

  it(`refuses a request that names more than ${MAX_SKILLS_PER_LOAD} skill IDs`, () => {
    expect(SkillsLoadRequestSchema.safeParse(request(MAX_SKILLS_PER_LOAD + 1)).success).toBe(false);
  });
});
