/**
 * A skill's id may not be another skill's `<skill-path>`.
 *
 * `skill://<id>/SKILL.md` also addresses a skill by its id, as `skills/list`, `skills/search` and
 * the Skilled OpenAPI meta-tools report it (#629). When that id is another skill's path, the URI
 * resolves to the path's owner while `loadSkill(<id>)` finds the id's owner, so a client building
 * the URI from a reported id is served, or judged as, the other skill. The registry refuses that
 * state, for skills declared at startup and for `registerSkillContent`.
 */
import 'reflect-metadata';

import { createProviderRegistryWithScope } from '../../__test-utils__/fixtures/scope.fixtures';
import { Skill, SkillContext, type ScopeEntry, type SkillContent } from '../../common';
import { InvalidSkillError, PublicMcpError } from '../../errors';
import { findSkillByPath } from '../sep-2640/sep-2640.resource-helpers';
import SkillRegistry from '../skill.registry';

const owner = () => ({ kind: 'app' as const, id: 'collision-app', ref: Symbol('collision') });

const content = (id: string, name: string, overrides: Partial<SkillContent> = {}): SkillContent => ({
  id,
  name,
  description: `${name} skill`,
  instructions: `# ${name}`,
  tools: [],
  ...overrides,
});

async function emptyRegistry(): Promise<SkillRegistry> {
  const registry = new SkillRegistry(await createProviderRegistryWithScope(), [], owner());
  await registry.ready;
  return registry;
}

function scopeOf(registry: SkillRegistry): ScopeEntry {
  return { skills: registry } as unknown as ScopeEntry;
}

interface TestProvider {
  add: (skill: SkillContent) => Promise<void>;
  count: (options?: { tags?: string[]; includeHidden?: boolean }) => Promise<number>;
  remove: (id: string) => Promise<void>;
  list: (options?: { offset?: number; limit?: number }) => Promise<{
    skills: { id?: string; name: string }[];
    total: number;
    hasMore: boolean;
  }>;
}

/** The registry's storage provider, whose `remove` or `list` a test can hold back, fail or cap. */
function providerOf(registry: SkillRegistry): TestProvider {
  return (registry as unknown as { storageProvider: TestProvider }).storageProvider;
}

/** Holds the provider's removals back until `release()`; `started` resolves once one begins. */
function holdRemovals(registry: SkillRegistry): { started: Promise<void>; release: () => void } {
  const provider = providerOf(registry);
  const remove = provider.remove.bind(provider);
  let release: () => void = () => undefined;
  let begin: () => void = () => undefined;
  const started = new Promise<void>((resolve) => (begin = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));
  provider.remove = async (id) => {
    begin();
    await released;
    return remove(id);
  };
  return { started, release: () => release() };
}

/** Let the adopting registry's asynchronous provider updates settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

async function skillIds(registry: SkillRegistry): Promise<Record<string, string[]>> {
  const ids = (list: { id?: string; name: string }[]) => list.map((m) => m.id ?? m.name).sort();
  return {
    search: ids((await registry.search('skill')).map((r) => r.metadata)),
    list: ids((await registry.listSkills()).skills),
    count: [String(await registry.count())],
  };
}

describe('SkillRegistry — a skill id that is another skill path', () => {
  describe('registerSkillContent', () => {
    it("refuses a skill whose id is another skill's path", async () => {
      const registry = await emptyRegistry();
      await registry.registerSkillContent(content('reports-v1', 'target'));

      await expect(registry.registerSkillContent(content('target', 'other'))).rejects.toThrow(PublicMcpError);
      await expect(registry.registerSkillContent(content('target', 'other'))).rejects.toThrow(
        /id "target" of skill "other" is the skill:\/\/ path of skill "target"/,
      );

      // Nothing changed: the URI still names the one skill it did.
      expect(registry.getSkills().map((s) => s.metadata.id)).toEqual(['reports-v1']);
      expect(findSkillByPath(scopeOf(registry), 'target')?.metadata.id).toBe('reports-v1');
    });

    it("refuses a skill whose path is another skill's id", async () => {
      const registry = await emptyRegistry();
      await registry.registerSkillContent(content('target', 'other'));

      await expect(registry.registerSkillContent(content('reports-v1', 'target'))).rejects.toThrow(
        /id "target" of skill "other" is the skill:\/\/ path of skill "target"/,
      );

      expect(findSkillByPath(scopeOf(registry), 'target')?.metadata.id).toBe('target');
      expect((await registry.loadSkill('target'))?.skill.name).toBe('other');
    });

    it('refuses a dynamic skill whose id is the path of a skill declared at startup', async () => {
      @Skill({ name: 'target', description: 'Declared at startup', instructions: '# target' })
      class TargetSkill extends SkillContext {}

      const registry = new SkillRegistry(await createProviderRegistryWithScope(), [TargetSkill], owner());
      await registry.ready;

      // Accepted, `skill://target/SKILL.md` would resolve to TargetSkill while `loadSkill('target')`
      // returned the dynamic skill's body, judged by TargetSkill's gates.
      await expect(registry.registerSkillContent(content('target', 'other'))).rejects.toThrow(PublicMcpError);

      expect((await registry.loadSkill('target'))?.skill.description).toBe('Declared at startup');
    });

    it('keeps a refused replacement from dropping the version it would have replaced', async () => {
      const registry = await emptyRegistry();
      await registry.registerSkillContent(content('invoices', 'invoices', { description: 'first' }));
      await registry.registerSkillContent(content('ledger', 'ledger'));

      await expect(
        registry.registerSkillContent(content('invoices', 'billing', { description: 'second' })),
      ).resolves.toMatchObject({ id: 'invoices' });
      await expect(registry.registerSkillContent(content('ledger', 'invoices'))).rejects.toThrow(PublicMcpError);

      expect((await registry.loadSkill('ledger'))?.skill.name).toBe('ledger');
    });

    it('accepts what a bundle sync registers: an id that is its own path, re-registration, renames', async () => {
      const registry = await emptyRegistry();

      // First sync.
      await registry.registerSkillContent(content('invoices', 'invoices'));
      await registry.registerSkillContent(content('reports', 'Reports'));
      // The next sync re-registers the same ids, one renamed, and adds one whose id is its path.
      await registry.registerSkillContent(content('invoices', 'invoices', { description: 'v2' }));
      await registry.registerSkillContent(content('reports', 'quarterly-reports'));
      await registry.registerSkillContent(content('refunds', 'refunds'));

      expect(
        registry
          .getSkills()
          .map((s) => s.metadata.id)
          .sort(),
      ).toEqual(['invoices', 'refunds', 'reports']);
      expect(findSkillByPath(scopeOf(registry), 'reports')?.metadata.name).toBe('quarterly-reports');
    });

    it("keeps an unregistered skill's earlier handle from removing its next registration", async () => {
      const registry = await emptyRegistry();
      const earlier = await registry.registerSkillContent(content('reports', 'reports'));
      await registry.unregisterSkill('reports');
      await registry.registerSkillContent(content('reports', 'reports', { description: 'again' }));

      await earlier.unregister();

      expect(registry.getSkills().map((s) => s.metadata.id)).toEqual(['reports']);
    });

    it("accepts a new skill at a path that a removed skill's id left free", async () => {
      const registry = await emptyRegistry();
      const old = await registry.registerSkillContent(content('target', 'other'));
      await old.unregister();

      await expect(registry.registerSkillContent(content('reports-v1', 'target'))).resolves.toMatchObject({
        id: 'reports-v1',
      });
    });
  });

  describe('registerSkillContent across calls and registries', () => {
    it('refuses one of two concurrent registrations that would collide', async () => {
      const registry = await emptyRegistry();

      const results = await Promise.allSettled([
        registry.registerSkillContent(content('reports-v1', 'target')),
        registry.registerSkillContent(content('target', 'other')),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(registry.getSkills()).toHaveLength(1);
    });

    it("refuses a child registry's skill whose id is a path in the registry that adopts it", async () => {
      const parent = await emptyRegistry();
      const child = await emptyRegistry();
      await parent.adoptFromChild(child, owner());
      await parent.registerSkillContent(content('reports-v1', 'target'));

      await expect(child.registerSkillContent(content('target', 'other'))).rejects.toThrow(
        /id "target" of skill "other" is the skill:\/\/ path of skill "target"/,
      );
      expect(child.getSkills()).toHaveLength(0);
      expect(findSkillByPath(scopeOf(parent), 'target')?.metadata.id).toBe('reports-v1');
    });

    it("refuses a child registry's skill that collides with a sibling registry's", async () => {
      const parent = await emptyRegistry();
      const first = await emptyRegistry();
      const second = await emptyRegistry();
      await parent.adoptFromChild(first, owner());
      await parent.adoptFromChild(second, owner());
      await first.registerSkillContent(content('reports-v1', 'target'));

      await expect(second.registerSkillContent(content('target', 'other'))).rejects.toThrow(PublicMcpError);
      expect(second.getSkills()).toHaveLength(0);
    });

    it("drops a child's removed skills from the registry that adopts it", async () => {
      const parent = await emptyRegistry();
      const child = await emptyRegistry();
      await parent.adoptFromChild(child, owner());
      await child.registerSkillContent(content('reports-v1', 'target'));
      await child.registerSkillContent(content('ledger', 'ledger'));
      await child.registerSkillContent(content('invoices', 'invoices'));
      await settle();
      expect((await skillIds(parent)).list).toEqual(['invoices', 'ledger', 'reports-v1']);

      // One removed by a superseding registration, one unregistered.
      await child.registerSkillContent(content('target', 'other'), { supersedes: ['reports-v1'] });
      await child.unregisterSkill('ledger');

      for (const phase of ['at once', 'once the provider caught up']) {
        if (phase !== 'at once') await settle();
        await expect(parent.loadSkill('reports-v1')).resolves.toBeUndefined();
        await expect(parent.loadSkill('ledger')).resolves.toBeUndefined();
        const ids = await skillIds(parent);
        expect(ids.list).not.toContain('reports-v1');
        expect(ids.list).not.toContain('ledger');
        expect(ids.search).not.toContain('reports-v1');
        expect(ids.search).not.toContain('ledger');
      }
      expect(await skillIds(parent)).toEqual({
        search: ['invoices', 'target'],
        list: ['invoices', 'target'],
        count: ['2'],
      });
    });

    it('refuses one of two concurrent registrations in sibling registries that would collide', async () => {
      const parent = await emptyRegistry();
      const first = await emptyRegistry();
      const second = await emptyRegistry();
      await parent.adoptFromChild(first, owner());
      await parent.adoptFromChild(second, owner());

      const results = await Promise.allSettled([
        first.registerSkillContent(content('reports-v1', 'target')),
        second.registerSkillContent(content('target', 'other')),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(parent.getSkills()).toHaveLength(1);
    });
  });

  // A bundle sync registers every skill of the new bundle, then unregisters the ones it drops, and
  // names in `supersedes` the previous bundle's skills it has not registered again yet.
  describe('registerSkillContent with supersedes', () => {
    it('accepts a new skill whose id is the path of a skill the same change drops, removing that skill', async () => {
      const registry = await emptyRegistry();
      const previous = await registry.registerSkillContent(content('reports-v1', 'target'));

      const handle = await registry.registerSkillContent(content('target', 'other'), { supersedes: ['reports-v1'] });

      // Removed in the same commit, so `skill://target/SKILL.md` and `loadSkill('target')` never
      // name different skills, even before the caller's own removal runs.
      expect(handle.removed).toEqual(['reports-v1']);
      expect(findSkillByPath(scopeOf(registry), 'target')?.metadata.name).toBe('other');
      expect(registry.getSkills().map((s) => s.metadata.id)).toEqual(['target']);
      await expect(previous.unregister()).resolves.toBeUndefined();
      expect(registry.getSkills().map((s) => s.metadata.id)).toEqual(['target']);
    });

    it('accepts a change that renames a kept skill off the path a new id takes', async () => {
      const registry = await emptyRegistry();
      await registry.registerSkillContent(content('reports', 'target'));

      const first = await registry.registerSkillContent(content('target', 'other'), { supersedes: ['reports'] });
      expect(first.removed).toEqual(['reports']);
      await registry.registerSkillContent(content('reports', 'quarterly'));

      expect(findSkillByPath(scopeOf(registry), 'quarterly')?.metadata.id).toBe('reports');
      expect(findSkillByPath(scopeOf(registry), 'target')?.metadata.name).toBe('other');
    });

    it("keeps a removed skill's earlier handle from removing its next registration", async () => {
      const registry = await emptyRegistry();
      const earlier = await registry.registerSkillContent(content('reports', 'target'));
      await registry.registerSkillContent(content('target', 'other'), { supersedes: ['reports'] });
      await registry.registerSkillContent(content('reports', 'quarterly'));

      await earlier.unregister();

      expect(findSkillByPath(scopeOf(registry), 'quarterly')?.metadata.id).toBe('reports');
    });

    it('does not serve a removed skill while its removal from the storage provider is pending', async () => {
      const registry = await emptyRegistry();
      await registry.registerSkillContent(content('reports-v1', 'target'));
      let release: () => void = () => undefined;
      let removing: () => void = () => undefined;
      const removeStarted = new Promise<void>((resolve) => (removing = resolve));
      const provider = providerOf(registry);
      const remove = provider.remove.bind(provider);
      provider.remove = async (id) => {
        removing();
        await new Promise<void>((resolve) => (release = resolve));
        return remove(id);
      };

      const registering = registry.registerSkillContent(content('target', 'other'), { supersedes: ['reports-v1'] });
      await removeStarted;

      await expect(registry.loadSkill('reports-v1')).resolves.toBeUndefined();
      expect((await skillIds(registry)).search).not.toContain('reports-v1');
      release();
      await registering;
      await expect(registry.loadSkill('reports-v1')).resolves.toBeUndefined();
    });

    it('does not serve a removed skill that the storage provider failed to remove', async () => {
      const registry = await emptyRegistry();
      await registry.registerSkillContent(content('reports-v1', 'target'));
      await registry.registerSkillContent(content('ledger', 'ledger'));
      providerOf(registry).remove = async () => {
        throw new Error('provider unavailable');
      };

      const handle = await registry.registerSkillContent(content('target', 'other'), { supersedes: ['reports-v1'] });

      expect(handle.removed).toEqual(['reports-v1']);
      await expect(registry.loadSkill('reports-v1')).resolves.toBeUndefined();
      expect(await skillIds(registry)).toEqual({
        search: ['ledger', 'target'],
        list: ['ledger', 'target'],
        count: ['2'],
      });

      // Registered again, it is served again.
      await registry.registerSkillContent(content('reports-v1', 'reports'));
      await expect(registry.loadSkill('reports-v1')).resolves.toMatchObject({ skill: { id: 'reports-v1' } });
      expect((await skillIds(registry)).list).toEqual(['ledger', 'reports-v1', 'target']);
    });

    it('keeps a superseded skill that does not collide with the new one', async () => {
      const registry = await emptyRegistry();
      await registry.registerSkillContent(content('invoices', 'invoices'));

      const handle = await registry.registerSkillContent(content('refunds', 'refunds'), { supersedes: ['invoices'] });

      expect(handle.removed).toEqual([]);
      expect(
        registry
          .getSkills()
          .map((s) => s.metadata.id)
          .sort(),
      ).toEqual(['invoices', 'refunds']);
    });

    it('refuses the registration that brings a superseded skill back to the colliding path', async () => {
      const registry = await emptyRegistry();
      await registry.registerSkillContent(content('reports', 'target'));
      await registry.registerSkillContent(content('target', 'other'), { supersedes: ['reports'] });

      await expect(registry.registerSkillContent(content('reports', 'target'))).rejects.toThrow(PublicMcpError);
    });

    it('still refuses a collision with a skill the change does not supersede', async () => {
      const registry = await emptyRegistry();
      await registry.registerSkillContent(content('reports-v1', 'target'));
      await registry.registerSkillContent(content('ledger', 'ledger'));

      await expect(
        registry.registerSkillContent(content('target', 'other'), { supersedes: ['ledger'] }),
      ).rejects.toThrow(/id "target" of skill "other" is the skill:\/\/ path of skill "target"/);
    });

    it('cannot supersede a skill declared at startup', async () => {
      @Skill({ id: 'target-skill', name: 'target', description: 'Declared', instructions: '# target' })
      class TargetSkill extends SkillContext {}

      const registry = new SkillRegistry(await createProviderRegistryWithScope(), [TargetSkill], owner());
      await registry.ready;

      await expect(
        registry.registerSkillContent(content('target', 'other'), { supersedes: ['target-skill'] }),
      ).rejects.toThrow(PublicMcpError);
    });
  });

  describe('the storage provider and adopting registries', () => {
    it('stops the adopting registry serving a superseded skill while the removal is pending', async () => {
      const parent = await emptyRegistry();
      const child = await emptyRegistry();
      await parent.adoptFromChild(child, owner());
      await child.registerSkillContent(content('reports-v1', 'target'));
      await settle();
      const held = holdRemovals(child);

      const registering = child.registerSkillContent(content('target', 'other'), { supersedes: ['reports-v1'] });
      await held.started;

      await expect(parent.loadSkill('reports-v1')).resolves.toBeUndefined();
      expect(findSkillByPath(scopeOf(parent), 'target')?.metadata.name).toBe('other');
      held.release();
      await registering;
    });

    it("keeps a skill a child registers again while the adopter's removal of it is pending", async () => {
      const parent = await emptyRegistry();
      const child = await emptyRegistry();
      await parent.adoptFromChild(child, owner());
      await child.registerSkillContent(content('ledger', 'ledger'));
      await settle();
      const held = holdRemovals(parent);

      await child.unregisterSkill('ledger');
      await held.started;
      await child.registerSkillContent(content('ledger', 'ledger', { description: 'ledger skill again' }));
      await settle();
      held.release();
      await settle();

      expect((await skillIds(parent)).list).toEqual(['ledger']);
      expect((await skillIds(parent)).count).toEqual(['1']);
    });

    it("does not bring back a child's removed skill when the adopter's first write of it lands late", async () => {
      const parent = await emptyRegistry();
      const child = await emptyRegistry();
      await child.registerSkillContent(content('ledger', 'ledger'));
      await child.registerSkillContent(content('invoices', 'invoices'));
      const provider = providerOf(parent);
      const add = provider.add.bind(provider);
      let release: () => void = () => undefined;
      let begin: () => void = () => undefined;
      const started = new Promise<void>((resolve) => (begin = resolve));
      const released = new Promise<void>((resolve) => (release = resolve));
      provider.add = async (skill) => {
        begin();
        await released;
        return add(skill);
      };

      const adopting = parent.adoptFromChild(child, owner());
      await started;
      await child.unregisterSkill('ledger');
      await settle();
      release();
      await adopting;
      await settle();

      await expect(parent.loadSkill('ledger')).resolves.toBeUndefined();
      expect(await skillIds(parent)).toEqual({ search: ['invoices'], list: ['invoices'], count: ['1'] });
    });

    it('counts what it lists when a removal completes between reading the count and the list', async () => {
      const registry = await emptyRegistry();
      await registry.registerSkillContent(content('ledger', 'ledger'));
      await registry.registerSkillContent(content('reports', 'reports'));
      const held = holdRemovals(registry);
      const unregistering = registry.unregisterSkill('reports');
      await held.started;
      // The removal completes right after the provider's first read (its count, or its list).
      const provider = providerOf(registry);
      const count = provider.count.bind(provider);
      const list = provider.list.bind(provider);
      let firstRead = true;
      const afterRead = async <T>(value: T): Promise<T> => {
        if (firstRead) {
          firstRead = false;
          held.release();
          await settle();
        }
        return value;
      };
      provider.count = async (options) => afterRead(await count(options));
      provider.list = async (options) => afterRead(await list(options));

      await expect(registry.count()).resolves.toBe(1);
      await unregistering;
      await expect(registry.count()).resolves.toBe((await registry.listSkills()).total);
    });

    it('does not count a withdrawn skill that a paging provider lists on a later page', async () => {
      const registry = await emptyRegistry();
      await registry.registerSkillContent(content('ledger', 'ledger'));
      await registry.registerSkillContent(content('reports-v1', 'target'));
      const provider = providerOf(registry);
      provider.remove = async () => {
        throw new Error('provider unavailable');
      };
      // A provider that returns one skill per page and reports the rest with `hasMore`.
      const list = provider.list.bind(provider);
      provider.list = async (options) => {
        const page = await list({ ...options, limit: Number.MAX_SAFE_INTEGER, offset: 0 });
        const offset = options?.offset ?? 0;
        return { skills: page.skills.slice(offset, offset + 1), total: page.total, hasMore: offset + 1 < page.total };
      };

      await registry.registerSkillContent(content('target', 'other'), { supersedes: ['reports-v1'] });

      await expect(registry.count()).resolves.toBe(2);
    });
  });

  describe('skills declared at startup', () => {
    it("fail to start when one skill's id is another's path", async () => {
      @Skill({ name: 'target', description: 'Addressed by its name', instructions: '# target' })
      class NamedSkill extends SkillContext {}

      @Skill({ id: 'target', name: 'other', description: 'Addressed by its id', instructions: '# other' })
      class AliasedSkill extends SkillContext {}

      const registry = new SkillRegistry(await createProviderRegistryWithScope(), [NamedSkill, AliasedSkill], owner());

      await expect(registry.ready).rejects.toThrow(InvalidSkillError);
      await expect(registry.ready).rejects.toThrow(
        /id "target" of skill "other" is the skill:\/\/ path of skill "target"/,
      );
    });

    it('start when every id is its own path or no other skill path', async () => {
      @Skill({ name: 'target', description: 'Addressed by its name', instructions: '# target' })
      class NamedSkill extends SkillContext {}

      @Skill({ id: 'other-id', name: 'other', description: 'Addressed by its id', instructions: '# other' })
      class AliasedSkill extends SkillContext {}

      @Skill({ id: 'plain', name: 'plain', description: 'Id equals name', instructions: '# plain' })
      class PlainSkill extends SkillContext {}

      const registry = new SkillRegistry(
        await createProviderRegistryWithScope(),
        [NamedSkill, AliasedSkill, PlainSkill],
        owner(),
      );

      await expect(registry.ready).resolves.toBeUndefined();
      expect(registry.getSkills()).toHaveLength(3);
    });
  });
});
