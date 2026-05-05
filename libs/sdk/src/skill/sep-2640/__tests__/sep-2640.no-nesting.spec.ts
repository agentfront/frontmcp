/**
 * SEP-2640 §Resource Mapping no-nesting test.
 *
 * Verifies that loadSkillDirectory rejects skill directories containing
 * nested SKILL.md files.
 */

import 'reflect-metadata';

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InvalidSkillError } from '../../../errors/sdk.errors';
import { findNestedSkillMd, loadSkillDirectory } from '../../skill-directory-loader';

async function makeSkillDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sep2640-'));
  const skillDir = join(dir, 'my-skill');
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), `---\nname: my-skill\ndescription: Demo skill for tests\n---\n\nBody.`);
  return skillDir;
}

describe('SEP-2640 §Resource Mapping — no nested SKILL.md', () => {
  describe('findNestedSkillMd', () => {
    it('returns empty when only the root SKILL.md exists', async () => {
      const dir = await makeSkillDir();
      const nested = await findNestedSkillMd(dir);
      expect(nested).toEqual([]);
    });

    it('finds a SKILL.md in a child directory', async () => {
      const dir = await makeSkillDir();
      await mkdir(join(dir, 'inner'), { recursive: true });
      await writeFile(join(dir, 'inner', 'SKILL.md'), '---\nname: inner\n---\nbody');
      const nested = await findNestedSkillMd(dir);
      expect(nested).toEqual(['inner/SKILL.md']);
    });

    it('finds deeply nested SKILL.md files', async () => {
      const dir = await makeSkillDir();
      await mkdir(join(dir, 'a', 'b', 'c'), { recursive: true });
      await writeFile(join(dir, 'a', 'b', 'c', 'SKILL.md'), '---\nname: deep\n---');
      const nested = await findNestedSkillMd(dir);
      expect(nested).toEqual(['a/b/c/SKILL.md']);
    });
  });

  describe('loadSkillDirectory', () => {
    it('loads cleanly when no nested SKILL.md exists', async () => {
      const dir = await makeSkillDir();
      const record = await loadSkillDirectory(dir);
      expect(record.metadata.name).toBe('my-skill');
    });

    it('rejects directories with nested SKILL.md', async () => {
      const dir = await makeSkillDir();
      await mkdir(join(dir, 'sub'), { recursive: true });
      await writeFile(join(dir, 'sub', 'SKILL.md'), '---\nname: sub\ndescription: nested\n---\nbody');
      await expect(loadSkillDirectory(dir)).rejects.toThrow(InvalidSkillError);
      await expect(loadSkillDirectory(dir)).rejects.toThrow(/SEP-2640/);
    });
  });
});
