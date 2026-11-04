/**
 * A skill's SKILL.md lists its actions only when a plugin's skill source judges which ones the caller may run.
 */
import 'reflect-metadata';

import type { ScopeEntry, SkillAction, SkillContent } from '../../../common';
import { ProviderNotRegisteredError } from '../../../errors';
import type { SkillCatalogSource } from '../../skill-catalog-source';
import { renderSkillMd } from '../sep-2640.resource-helpers';

const action = (actionId: string): SkillAction => ({
  actionId,
  summary: `${actionId} summary`,
  inputJsonSchema: { type: 'object' },
  outputJsonSchema: { type: 'object' },
});

const skill: SkillContent = {
  id: 'orders',
  name: 'orders',
  description: 'Manage orders.',
  instructions: '# Orders',
  tools: [],
  actions: [action('getOrder'), action('voidOrder')],
};

function scopeWith(source?: SkillCatalogSource): ScopeEntry {
  const providers = {
    get: () => {
      if (!source) throw new ProviderNotRegisteredError('SkillCatalogSource');
      return source;
    },
  };
  return { logger: { warn: jest.fn() }, providers } as unknown as ScopeEntry;
}

describe('renderSkillMd', () => {
  it('lists no actions without a skill source that judges them', async () => {
    const withoutSource = await renderSkillMd(scopeWith(), skill, {});
    const withoutActions = await renderSkillMd(scopeWith({ ready: async () => undefined }), skill, {});

    expect(withoutSource).not.toContain('## Actions');
    expect(withoutActions).toBe(withoutSource);
  });

  it("lists the actions the source gives for the caller, with the source's hint", async () => {
    const visibleTo = jest.fn(async (_skill: SkillContent, authInfo: unknown) =>
      (authInfo as { admin?: boolean }).admin ? [action('getOrder'), action('voidOrder')] : [action('getOrder')],
    );
    const scope = scopeWith({ ready: async () => undefined, actions: { hint: 'Run one with `run`.', visibleTo } });

    const asViewer = await renderSkillMd(scope, skill, { admin: false });
    const asAdmin = await renderSkillMd(scope, skill, { admin: true });

    expect(asViewer).toContain('## Actions\n\nRun one with `run`.\n\n### getOrder');
    expect(asViewer).not.toContain('voidOrder');
    expect(asAdmin).toContain('### voidOrder');
    expect(visibleTo).toHaveBeenCalledWith(skill, { admin: false });
  });
});
