/**
 * `isEntryGatedBy`: whether a plugin instance's hooks run when the scope serves an entry, read the
 * way the serving flows read it (the entry's hook owner, then `getFlowHooksForOwner`).
 */
import type {
  EntryLineage,
  EntryOwnerRef,
  PromptEntry,
  ResourceEntry,
  ScopeEntry,
  SkillEntry,
  ToolEntry,
} from '../../common';
import { isEntryGatedBy } from '../hook-coverage';

const owner = (kind: EntryOwnerRef['kind'], id: string): EntryOwnerRef => ({ kind, id, ref: id });

/** A scope whose hook registry answers `<flow>|<ownerId>` with hooks of the given targets. */
function scopeWith(targetsFor: Record<string, object[]>, lineage: EntryLineage) {
  const getFlowHooksForOwner = jest.fn((flow: string, ownerId: string | undefined) =>
    (targetsFor[`${flow}|${ownerId}`] ?? []).map((target) => ({ metadata: { target } })),
  );
  const lineageOf = () => lineage;
  const scope = {
    hooks: { getFlowHooksForOwner },
    tools: { lineageOf },
    resources: { lineageOf },
    prompts: { lineageOf },
  } as unknown as ScopeEntry;
  return { scope, getFlowHooksForOwner };
}

describe('isEntryGatedBy', () => {
  const plugin = {};
  const otherPlugin = {};
  const inBilling: EntryLineage = [owner('scope', 'gw'), owner('app', 'billing')];

  it("reads a tool's tools/call hooks for the app in its lineage", () => {
    const { scope, getFlowHooksForOwner } = scopeWith({ 'tools:call-tool|billing': [plugin] }, inBilling);
    const tool = { owner: owner('adapter', 'api') } as unknown as ToolEntry;

    expect(isEntryGatedBy(scope, { tool }, plugin)).toBe(true);
    expect(isEntryGatedBy(scope, { tool }, otherPlugin)).toBe(false);
    expect(getFlowHooksForOwner).toHaveBeenCalledWith('tools:call-tool', 'billing');
  });

  it("falls back to a tool's own owner outside every app, as tools/call does", () => {
    const { scope } = scopeWith({ 'tools:call-tool|notes': [plugin] }, [owner('scope', 'gw')]);
    const tool = { owner: owner('plugin', 'notes') } as unknown as ToolEntry;

    expect(isEntryGatedBy(scope, { tool }, plugin)).toBe(true);
  });

  it("reads a resource's resources/read hooks, and every hook outside every app", () => {
    const resource = { owner: owner('app', 'billing') } as unknown as ResourceEntry;
    expect(
      isEntryGatedBy(scopeWith({ 'resources:read-resource|billing': [plugin] }, inBilling).scope, { resource }, plugin),
    ).toBe(true);

    const serverResource = { owner: owner('scope', 'gw') } as unknown as ResourceEntry;
    const { scope, getFlowHooksForOwner } = scopeWith({ 'resources:read-resource|undefined': [plugin] }, []);
    expect(isEntryGatedBy(scope, { resource: serverResource }, plugin)).toBe(true);
    expect(getFlowHooksForOwner).toHaveBeenCalledWith('resources:read-resource', undefined);
  });

  it("reads a prompt's prompts/get hooks", () => {
    const prompt = { owner: owner('app', 'billing') } as unknown as PromptEntry;
    const { scope } = scopeWith({ 'prompts:get-prompt|billing': [otherPlugin] }, inBilling);

    expect(isEntryGatedBy(scope, { prompt }, plugin)).toBe(false);
    expect(isEntryGatedBy(scope, { prompt }, otherPlugin)).toBe(true);
  });

  it("reads a skill's skills:filter hooks for its app", () => {
    const skill = { owner: owner('app', 'help-desk') } as unknown as SkillEntry;
    const { scope, getFlowHooksForOwner } = scopeWith({ 'skills:filter|help-desk': [plugin] }, []);

    expect(isEntryGatedBy(scope, { skill }, plugin)).toBe(true);
    expect(getFlowHooksForOwner).toHaveBeenCalledWith('skills:filter', 'help-desk');
  });
});
