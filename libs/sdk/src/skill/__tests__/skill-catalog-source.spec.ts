import 'reflect-metadata';

import { readySkillCatalog, SkillCatalogSourceToken, type SkillCatalogSource } from '../skill-catalog-source';

function scopeWith(source: SkillCatalogSource) {
  const warn = jest.fn();
  const scope = {
    logger: { warn },
    providers: {
      get: (token: unknown) => {
        if (token !== SkillCatalogSourceToken) throw new Error('unexpected token');
        return source;
      },
    },
  } as unknown as Parameters<typeof readySkillCatalog>[0];
  return { scope, warn };
}

describe('readySkillCatalog', () => {
  it('serves the registered skills, and logs, when the source cannot report whether its skills loaded', async () => {
    const source: SkillCatalogSource = {
      ready: async () => undefined,
      notLoadedReason: () => {
        throw new Error('status store is down');
      },
    };
    const { scope, warn } = scopeWith(source);

    await expect(readySkillCatalog(scope)).resolves.toEqual({ source, notLoadedReason: undefined });
    expect(warn).toHaveBeenCalledWith(
      'a skill source failed to report whether its skills loaded; serving the skills registered so far',
      { error: 'status store is down' },
    );
  });

  it('reports why the skills are not loaded after a ready() that rejects', async () => {
    const source: SkillCatalogSource = {
      ready: async () => {
        throw new Error('pull failed');
      },
      notLoadedReason: () => 'pull responded 503',
    };
    const { scope, warn } = scopeWith(source);

    await expect(readySkillCatalog(scope)).resolves.toEqual({ source, notLoadedReason: 'pull responded 503' });
    expect(warn).toHaveBeenCalledWith('a skill source failed to load; serving the skills registered so far', {
      error: 'pull failed',
    });
  });
});
