import type { SkillContent } from '../../common/interfaces';
import { MemorySkillProvider } from '../providers/memory-skill.provider';

const skill = (id: string, description: string): SkillContent =>
  ({ id, name: id, description, instructions: description, tools: [] }) as unknown as SkillContent;

const vectorDbOf = (provider: MemorySkillProvider) => (provider as unknown as { vectorDB?: unknown }).vectorDB;

describe('MemorySkillProvider search index', () => {
  it('builds no index until the first search', async () => {
    const provider = new MemorySkillProvider();
    await provider.addMany([skill('review-pr', 'Review a GitHub pull request')]);
    expect(vectorDbOf(provider)).toBeUndefined();

    const results = await provider.search('pull request');
    expect(results.map((r) => r.metadata.id)).toEqual(['review-pr']);
    expect(vectorDbOf(provider)).toBeDefined();
  });

  it('gives concurrent first searches one index', async () => {
    const provider = new MemorySkillProvider();
    await provider.addMany([
      skill('review-pr', 'Review a GitHub pull request'),
      skill('deploy', 'Deploy the application to production'),
    ]);

    const [first, second] = await Promise.all([provider.search('pull request'), provider.search('production')]);
    expect(first.map((r) => r.metadata.id)).toEqual(['review-pr']);
    expect(second.map((r) => r.metadata.id)).toEqual(['deploy']);

    const db = vectorDbOf(provider);
    await provider.search('deploy');
    expect(vectorDbOf(provider)).toBe(db);
  });
});
