import { disposeAllCaches } from '../../cache';
import LlmFullTxtFlow from '../http/llm-full-txt.flow';
import LlmTxtFlow from '../http/llm-txt.flow';

type SkillStub = {
  name: string;
  fullName: string;
  metadata: { name: string; description: string };
  getDescription(): string;
  getToolNames(): string[];
};

const skillNamed = (name: string): SkillStub => ({
  name,
  fullName: `app:${name}`,
  metadata: { name, description: `${name} description` },
  getDescription: () => `${name} description`,
  getToolNames: () => [],
});

/** A scope whose registry holds `catalog.skills`, with the skills HTTP cache on. */
function scopeWith(catalog: { skills: SkillStub[] }, scopeId: string) {
  return {
    metadata: { id: scopeId, skillsConfig: { enabled: true, cache: { enabled: true } } },
    logger: { warn: jest.fn(), verbose: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() },
    skills: {
      hasAny: () => catalog.skills.length > 0,
      getSkills: () => catalog.skills,
      loadSkill: async (name: string) => ({
        skill: { id: name, name, description: '', instructions: `${name} instructions`, tools: [] },
        availableTools: [],
        missingTools: [],
        isComplete: true,
      }),
    },
    tools: { getTools: () => [] },
    runFlowForOutput: async (_flow: string, input: { skills: SkillStub[] }) => ({ skills: input.skills }),
  };
}

/** Run one stage of a flow on a stub, and return the body it responded with. */
async function bodyOf(flow: { prototype: { generateContent(): Promise<void> } }, scope: unknown): Promise<string> {
  const respond = jest.fn();
  await flow.prototype.generateContent.call({ scope, state: { required: { authInfo: {} } }, respond });
  return respond.mock.calls[0][0].body;
}

describe('the cached /llm.txt and /llm_full.txt documents', () => {
  afterEach(() => disposeAllCaches());

  it.each([
    ['/llm_full.txt', LlmFullTxtFlow, 'scope-full'],
    ['/llm.txt', LlmTxtFlow, 'scope-compact'],
  ])('%s is made again once a skill is removed, not served from the earlier catalog', async (_path, flow, scopeId) => {
    const catalog = { skills: [skillNamed('public-skill'), skillNamed('removed-skill')] };
    const scope = scopeWith(catalog, scopeId);

    expect(await bodyOf(flow, scope)).toContain('removed-skill');

    catalog.skills = [skillNamed('public-skill')];
    const body = await bodyOf(flow, scope);

    expect(body).toContain('public-skill');
    expect(body).not.toContain('removed-skill');
  });

  it('serves the cached document while the catalog is unchanged', async () => {
    const catalog = { skills: [skillNamed('public-skill')] };
    const scope = scopeWith(catalog, 'scope-unchanged');
    const loadSkill = jest.spyOn(scope.skills, 'loadSkill');

    const first = await bodyOf(LlmFullTxtFlow, scope);
    const second = await bodyOf(LlmFullTxtFlow, scope);

    expect(second).toBe(first);
    expect(loadSkill).toHaveBeenCalledTimes(1);
  });
});
