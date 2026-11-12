/**
 * `findAndLoadSkillByPath` returns the content of the registration it returns, which the caller is
 * authorized against: a skill replaced while it loads is not served under the earlier registration.
 */
import type { ScopeEntry, SkillEntry } from '../../../common';
import { findAndLoadSkillByPath } from '../sep-2640.resource-helpers';

function skill(name: string, authorities?: unknown): SkillEntry {
  return { name, metadata: { name, authorities }, getSkillPath: () => name } as unknown as SkillEntry;
}

const contentOf = (instructions: string) => ({
  skill: { id: 'reports', name: 'reports', description: '', instructions, tools: [] },
  availableTools: [],
  missingTools: [],
  isComplete: true,
});

describe('findAndLoadSkillByPath', () => {
  it('does not serve content a registration replaced during the load', async () => {
    const registered = { skills: [skill('reports')] };
    const scope = {
      logger: { warn: jest.fn() },
      skills: {
        hasAny: () => true,
        getSkills: () => registered.skills,
        loadSkill: async () => {
          registered.skills = [skill('reports', { roles: ['admin'] })];
          return contentOf('restricted instructions');
        },
      },
      runFlowForOutput: async (_flow: string, input: { skills: SkillEntry[] }) => ({ skills: input.skills }),
    } as unknown as ScopeEntry;

    await expect(findAndLoadSkillByPath(scope, 'reports')).rejects.toThrow('skill://reports/SKILL.md');
  });

  it('returns the content with the registration it was loaded from', async () => {
    const entry = skill('reports');
    const scope = {
      logger: { warn: jest.fn() },
      skills: { hasAny: () => true, getSkills: () => [entry], loadSkill: async () => contentOf('public instructions') },
      runFlowForOutput: async (_flow: string, input: { skills: SkillEntry[] }) => ({ skills: input.skills }),
    } as unknown as ScopeEntry;

    const { instance, loadResult } = await findAndLoadSkillByPath(scope, 'reports');
    expect(instance).toBe(entry);
    expect(loadResult.skill.instructions).toBe('public instructions');
  });
});
