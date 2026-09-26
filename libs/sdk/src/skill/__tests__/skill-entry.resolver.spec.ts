/**
 * The one resolver every skill surface uses to map a skill id (a search or list result id, a
 * requested load id, or the id of loaded content) to its registered entry (#599).
 */
import type { SkillEntry } from '../../common';
import { createSkillEntryResolver, type SkillEntryLookup } from '../skill-entry.resolver';

function skill(name: string, metadata: { id?: string; name?: string } = {}): SkillEntry {
  return { name, metadata: { name: metadata.name ?? name, ...metadata } } as unknown as SkillEntry;
}

function lookupOf(options: {
  byName?: Record<string, SkillEntry>;
  byQualifiedName?: Record<string, SkillEntry>;
  skills?: SkillEntry[];
}) {
  return {
    findByName: jest.fn((id: string) => options.byName?.[id]),
    findByQualifiedName: jest.fn((id: string) => options.byQualifiedName?.[id]),
    getSkills: jest.fn(() => options.skills ?? []),
  } satisfies SkillEntryLookup;
}

describe('createSkillEntryResolver', () => {
  it('resolves an id by registry name first', () => {
    const deploy = skill('deploy');
    const resolve = createSkillEntryResolver(lookupOf({ byName: { deploy }, skills: [deploy] }));

    expect(resolve('deploy')).toBe(deploy);
  });

  it('resolves a qualified name', () => {
    const deploy = skill('deploy');
    const resolve = createSkillEntryResolver(lookupOf({ byQualifiedName: { 'app:ops:deploy': deploy } }));

    expect(resolve('app:ops:deploy')).toBe(deploy);
  });

  it('falls back to the display name', () => {
    const release = skill('release-v2', { id: 'release-v2', name: 'release' });
    const resolve = createSkillEntryResolver(lookupOf({ skills: [release] }));

    expect(resolve('release')).toBe(release);
  });

  it('prefers the skill registered under an id over another skill whose display name is that id', () => {
    const shadow = skill('shadow', { id: 'shadow', name: 'report' });
    const report = skill('report');
    const resolve = createSkillEntryResolver(lookupOf({ byName: { report }, skills: [shadow, report] }));

    expect(resolve('report')).toBe(report);
  });

  it('tries each candidate id in order, so the requested id wins over the loaded content id', () => {
    const requested = skill('requested');
    const loaded = skill('loaded');
    const resolve = createSkillEntryResolver(lookupOf({ byName: { requested, loaded } }));

    expect(resolve('requested', 'loaded')).toBe(requested);
    expect(resolve('unknown', 'loaded')).toBe(loaded);
  });

  it('returns undefined for an id no registered skill answers to', () => {
    const resolve = createSkillEntryResolver(lookupOf({ skills: [skill('deploy')] }));

    expect(resolve('external-skill', undefined)).toBeUndefined();
  });

  it('lists the registry once however many ids miss', () => {
    const lookup = lookupOf({ skills: [skill('deploy'), skill('release')] });
    const resolve = createSkillEntryResolver(lookup);

    for (let index = 0; index < 25; index += 1) resolve(`external-${index}`);

    expect(lookup.getSkills).toHaveBeenCalledTimes(1);
  });

  it('only scans qualified names for ids that can be one', () => {
    const lookup = lookupOf({});
    const resolve = createSkillEntryResolver(lookup);

    resolve('plain-id');
    resolve('app:ops:deploy');

    expect(lookup.findByQualifiedName.mock.calls).toEqual([['app:ops:deploy']]);
  });
});
