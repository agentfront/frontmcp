import { isAbsolute, pathJoin } from '@frontmcp/utils';

import { loadSkillDirectory, skillDir } from '../skill-directory-loader';

/**
 * A relative skill directory resolves against the file that calls `skillDir()` /
 * `loadSkillDirectory()`, as `@Skill({ instructions: { file } })` does, then the working directory.
 * This spec's directory is not the working directory.
 */
describe('relative skill directory paths', () => {
  const fixture = pathJoin(__dirname, 'fixtures', 'caller-relative-skill', 'SKILL.md');

  it('skillDir() resolves a relative path against the calling file', async () => {
    const record = await skillDir('./fixtures/caller-relative-skill');

    expect(record.metadata.name).toBe('caller-relative-skill');
    expect(record.filePath).toBe(fixture);
  });

  it('loadSkillDirectory() resolves a relative path against the calling file', async () => {
    const record = await loadSkillDirectory('fixtures/caller-relative-skill');

    expect(record.filePath).toBe(fixture);
  });

  it('loads an absolute path as given', async () => {
    const record = await skillDir(pathJoin(__dirname, 'fixtures', 'caller-relative-skill'));

    expect(record.filePath).toBe(fixture);
  });

  it('still finds a directory that is relative to the working directory', async () => {
    const fromCwd = pathJoin(__dirname, 'fixtures', 'caller-relative-skill').replace(`${process.cwd()}/`, '');
    expect(isAbsolute(fromCwd)).toBe(false);

    const record = await skillDir(fromCwd);

    expect(record.filePath).toBe(fixture);
  });
});
