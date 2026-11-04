import {
  assignSkillFolders,
  describeBundleRefresh,
  describeSkillRecord,
  describeSkills,
  skillFolderName,
} from '../skill-tree';

describe('skillFolderName', () => {
  it.each([
    ['Guarded action', 'guarded-action'],
    ['Invoices', 'invoices'],
    ['  Refunds & credits (v2)!  ', 'refunds-credits-v2'],
    ['Créer une facture', 'creer-une-facture'],
    ['../../escape', 'escape'],
    ['billing/admin', 'billing-admin'],
    ['日本語', 'skill'],
    ['---', 'skill'],
  ])('names %j %j', (name, folder) => {
    expect(skillFolderName(name)).toBe(folder);
  });

  it('cuts a long name to 64 characters, without a trailing hyphen', () => {
    const folder = skillFolderName(`${'a'.repeat(63)} b`);

    expect(folder).toBe('a'.repeat(63));
  });
});

describe('assignSkillFolders', () => {
  it('suffixes a folder a reserved folder or an earlier skill already has', () => {
    expect(assignSkillFolders(['Invoices', 'invoices', 'INVOICES', 'Math helper'], ['math-helper'])).toEqual([
      'invoices',
      'invoices-2',
      'invoices-3',
      'math-helper-2',
    ]);
  });

  it('never repeats a folder, even when a suffixed name is itself a skill name', () => {
    const folders = assignSkillFolders(['Refunds 2', 'Refunds', 'refunds'], []);

    expect(folders).toEqual(['refunds-2', 'refunds', 'refunds-3']);
    expect(new Set(folders).size).toBe(folders.length);
  });

  it('keeps a suffixed folder within 64 characters', () => {
    const long = 'x'.repeat(70);

    const [first, second] = assignSkillFolders([long, long], []);

    expect(first).toBe('x'.repeat(64));
    expect(second).toBe(`${'x'.repeat(62)}-2`);
  });
});

describe('describing skills', () => {
  it('lists the skills by kind, with a bundle skill name that differs from its folder', () => {
    expect(
      describeSkills(['math-helper'], {
        bundleVersion: '1.4.0',
        skills: [
          { folder: 'guarded-action', name: 'Guarded action' },
          { folder: 'refunds', name: 'refunds' },
        ],
      }),
    ).toEqual(['shipped skills: math-helper', 'bundle skills (bundle 1.4.0): guarded-action (Guarded action), refunds']);
    expect(describeSkills([], undefined)).toEqual(['shipped skills: none']);
  });

  it('describes a record by its folders', () => {
    expect(
      describeSkillRecord({
        skills: ['invoices', 'math-helper'],
        bundleSkills: { bundleVersion: '2.0.0', skills: ['invoices'] },
        managedFiles: [],
      }),
    ).toEqual(['shipped skills: math-helper', 'bundle skills (bundle 2.0.0): invoices']);
  });

  it('summarizes a refresh', () => {
    expect(
      describeBundleRefresh({
        added: ['refunds'],
        updated: ['invoices', 'payments'],
        removed: [],
        filesWritten: [],
        filesRemoved: [],
      }),
    ).toBe('1 added (refunds), 2 updated (invoices, payments), 0 removed');
  });
});
