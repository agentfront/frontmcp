/**
 * The index snapshot cache key names the tokenizer, so a snapshot cached before vectoriadb 2.3.4, whose terms are
 * ASCII-only, is not restored and re-indexed on every cold start: the first search rebuilds and saves a snapshot
 * under the new key, and the next cold start restores it.
 */
import { TFIDFVectoria } from 'vectoriadb';

import { sha256Hex } from '@frontmcp/utils';

import type { SkillContent } from '../../common/interfaces';
import { MemorySkillProvider } from '../providers/memory-skill.provider';
import type { SkillIndexCache } from '../skill-index-cache.interface';
import { skillSearchText } from '../skill-search-text';

const skill: SkillContent = {
  id: 'katalog-he',
  name: 'katalog-he',
  description: 'מציאת כלבים, חתולים וציפורים',
  instructions: '',
  tools: [],
};

function mapCache(): SkillIndexCache & { entries: Map<string, unknown> } {
  const entries = new Map<string, unknown>();
  return {
    entries,
    get: async (key) => entries.get(key),
    set: async (key, value) => {
      entries.set(key, value);
    },
  };
}

async function providerWith(cache: SkillIndexCache): Promise<MemorySkillProvider> {
  const provider = new MemorySkillProvider({ indexCache: cache });
  await provider.initialize();
  await provider.add(skill);
  return provider;
}

describe('the skill index snapshot cache and the tokenizer (#1065)', () => {
  it('saves a snapshot for the new tokenizer once, and restores it on the next cold start', async () => {
    const cache = mapCache();
    const legacyKey = sha256Hex(`frontmcp-skill-index:v1|cosine|1|${skill.id}\u0000${skillSearchText(skill)}`);
    cache.entries.set(legacyKey, { legacy: true });

    const first = await providerWith(cache);
    expect((await first.search('חתולים')).map((r) => r.metadata.id)).toEqual(['katalog-he']);

    const savedKeys = [...cache.entries.keys()].filter((key) => key !== legacyKey);
    expect(savedKeys).toHaveLength(1);

    const reindex = jest.spyOn(TFIDFVectoria.prototype, 'reindex');
    try {
      const second = await providerWith(cache);
      expect((await second.search('חתולים')).map((r) => r.metadata.id)).toEqual(['katalog-he']);
      expect(reindex).not.toHaveBeenCalled();
    } finally {
      reindex.mockRestore();
    }
  });

  it('re-indexes when only the bundleVersion changes, so a restored index never reports the old one', async () => {
    const cache = mapCache();
    const other: SkillContent = {
      id: 'orders',
      name: 'orders',
      description: 'Track customer orders',
      instructions: '',
      tools: [],
    };
    const first = new MemorySkillProvider({ indexCache: cache });
    await first.initialize();
    await first.add({ ...skill, bundleVersion: '1.0.0' });
    await first.add(other);
    await first.search('חתולים');

    const second = new MemorySkillProvider({ indexCache: cache });
    await second.initialize();
    await second.add({ ...skill, bundleVersion: '2.0.0' });
    await second.add(other);
    const [result] = await second.search('חתולים');

    expect(result.metadata.id).toBe('katalog-he');
    expect(result.bundleVersion).toBe('2.0.0');
    expect(cache.entries.size).toBe(2);
  });
});
