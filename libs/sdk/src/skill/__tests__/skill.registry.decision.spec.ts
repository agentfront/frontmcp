/**
 * `skillsConfig.decision` (#1062): the registry's search ranks with a decision model, which chooses among the
 * index's candidates (every skill in a small catalog) without embeddings.
 */
import 'reflect-metadata';

import { createProviderRegistryWithScope } from '../../__test-utils__/fixtures/scope.fixtures';
import { type SkillContent } from '../../common/interfaces';
import type { SkillDecider, SkillDecisionRequest } from '../decision';
import SkillRegistry from '../skill.registry';

const owner = () => ({ kind: 'app' as const, id: 'decision-test', ref: Symbol('decision-test') });

const content = (id: string, description: string, tags?: string[]): SkillContent => ({
  id,
  name: id,
  description,
  instructions: `# ${id}`,
  tools: [],
  ...(tags ? { tags } : {}),
});

async function registryWith(decider: SkillDecider): Promise<SkillRegistry> {
  const providers = await createProviderRegistryWithScope();
  const registry = new SkillRegistry(providers, [], owner(), { decision: { decider } });
  await registry.ready;
  await registry.registerSkillContent(content('pet-catalog', 'Find dogs, cats and birds', ['puppies']));
  await registry.registerSkillContent(content('store', 'Count the pets in stock, and read an order'));
  return registry;
}

describe('SkillRegistry search with a decision model (#1062)', () => {
  it('finds a skill by meaning, for a query that shares no word with it', async () => {
    const requests: SkillDecisionRequest[] = [];
    const registry = await registryWith(async (request) => {
      requests.push(request);
      return [{ id: 'pet-catalog', probability: 0.92 }];
    });

    const results = await registry.search('kittens');

    expect(results.map((r) => [r.metadata.id, r.score])).toEqual([['pet-catalog', 0.92]]);
    expect(requests[0].candidates.map((c) => c.id).sort()).toEqual(['pet-catalog', 'store']);
  });

  it('chooses only among the skills the filters keep', async () => {
    const decider = jest.fn<ReturnType<SkillDecider>, Parameters<SkillDecider>>(async () => [
      { id: 'pet-catalog', probability: 0.9 },
    ]);
    const registry = await registryWith(decider);

    await registry.search('kittens', { tags: ['puppies'] });

    expect(decider.mock.calls[0][0].candidates.map((c) => c.id)).toEqual(['pet-catalog']);
  });

  it('ranks by the index when the decision model fails', async () => {
    const registry = await registryWith(async () => Promise.reject(new Error('unavailable')));

    expect((await registry.search('order')).map((r) => r.metadata.id)).toEqual(['store']);
  });

  it('asks the decision model nothing for an empty query', async () => {
    const decider = jest.fn(async () => []);
    const registry = await registryWith(decider);

    await registry.search('  ');

    expect(decider).not.toHaveBeenCalled();
  });
});
