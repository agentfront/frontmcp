import { skillMetadataSchema } from '../../common/metadata/skill.metadata';
import {
  SkillSemanticSearchToken,
  type SkillSemanticSearchProvider,
} from '../semantic/skill-semantic-search.interface';

describe('skillMetadataSchema — rating + category', () => {
  const baseValid = {
    name: 'review-pr',
    description: 'Review a pull request',
    instructions: 'Do the review',
    tools: [],
  };

  it('accepts a valid rating in [0, 5]', () => {
    const ok = skillMetadataSchema.safeParse({ ...baseValid, rating: 4.5 });
    expect(ok.success).toBe(true);
  });

  it('accepts category strings', () => {
    const ok = skillMetadataSchema.safeParse({ ...baseValid, category: 'deployment' });
    expect(ok.success).toBe(true);
  });

  it('rejects rating > 5', () => {
    const r = skillMetadataSchema.safeParse({ ...baseValid, rating: 5.5 });
    expect(r.success).toBe(false);
  });

  it('rejects rating < 0', () => {
    const r = skillMetadataSchema.safeParse({ ...baseValid, rating: -0.1 });
    expect(r.success).toBe(false);
  });

  it('omits rating/category from parsed output when not provided', () => {
    const r = skillMetadataSchema.safeParse(baseValid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.rating).toBeUndefined();
      expect(r.data.category).toBeUndefined();
    }
  });
});

describe('SkillSemanticSearchToken', () => {
  it('exposes a Symbol token shape', () => {
    expect(typeof SkillSemanticSearchToken).toBe('symbol');
    // Stable identity — re-import yields the same Symbol.for() registry slot.

    const reimport = require('../semantic/skill-semantic-search.interface');
    expect(reimport.SkillSemanticSearchToken).toBe(SkillSemanticSearchToken);
  });

  it('the interface shape is callable when implemented', async () => {
    // Verifies that an in-memory provider can plug into the documented shape.
    class StubProvider implements SkillSemanticSearchProvider {
      readonly name = 'stub';
      private docs = new Map<string, string>();
      async index(id: string, content: { description: string }): Promise<void> {
        this.docs.set(id, content.description);
      }
      async remove(id: string): Promise<void> {
        this.docs.delete(id);
      }
      async search(query: string, limit: number): Promise<{ skillId: string; score: number }[]> {
        const matches = [...this.docs.entries()]
          .filter(([, desc]) => desc.toLowerCase().includes(query.toLowerCase()))
          .map(([id]) => ({ skillId: id, score: 1 }))
          .slice(0, limit);
        return matches;
      }
    }

    const provider = new StubProvider();
    await provider.index('a', { description: 'Alpha skill' } as never);
    await provider.index('b', { description: 'Beta skill' } as never);
    const hits = await provider.search('beta', 5);
    expect(hits).toEqual([{ skillId: 'b', score: 1 }]);

    await provider.remove('b');
    const after = await provider.search('beta', 5);
    expect(after).toHaveLength(0);
  });
});
