/**
 * Which files `skill://<skill>/<file>` serves: a skill directory's own files, and a skill declared in
 * code only the resource directories it declares.
 */

import 'reflect-metadata';

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SkillKind, type EntryOwnerRef, type SkillMetadata } from '../../../common';
import { ResourceNotFoundError } from '../../../errors';
import type ProviderRegistry from '../../../provider/provider.registry';
import { loadSkillDirectory } from '../../skill-directory-loader';
import { createSkillInstance, type SkillInstance } from '../../skill.instance';
import { readSkillFileByPath } from '../sep-2640.resource-helpers';

const providers = {
  getActiveScope: () => ({ logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }),
} as unknown as ProviderRegistry;
const owner: EntryOwnerRef = { kind: 'app', id: 'app', ref: Symbol('app') };

/** A temporary folder with a file outside any skill, and a skill directory next to it. */
async function makeWorkspace(): Promise<{ root: string; skillDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'skill-file-'));
  const skillDir = join(root, 'my-skill');
  await mkdir(join(root, 'outside'), { recursive: true });
  await writeFile(join(root, 'outside', 'secret.md'), '# Outside\n\nnot part of any skill');
  await mkdir(skillDir, { recursive: true });
  return { root, skillDir };
}

/** A skill directory's instance, loaded the way `skillDir()` loads it. */
async function directorySkill(skillDir: string, frontmatter = ''): Promise<SkillInstance> {
  await writeFile(
    join(skillDir, 'SKILL.md'),
    `---\nname: my-skill\ndescription: A test skill\n${frontmatter}---\n\nBody.`,
  );
  return createSkillInstance(await loadSkillDirectory(skillDir), providers, owner);
}

/** A skill declared in code, in a module in `callerDir`. */
function declaredSkill(callerDir: string, resources?: SkillMetadata['resources']): SkillInstance {
  const metadata: SkillMetadata = { name: 'my-skill', description: 'A test skill', instructions: 'Body.', resources };
  return createSkillInstance({ kind: SkillKind.VALUE, provide: Symbol('skill'), metadata, callerDir }, providers, owner);
}

describe('readSkillFileByPath', () => {
  describe('a skill directory', () => {
    it('serves its own files', async () => {
      const { skillDir } = await makeWorkspace();
      await mkdir(join(skillDir, 'assets'));
      await writeFile(join(skillDir, 'assets', 'note.txt'), 'asset');
      await writeFile(join(skillDir, 'README.txt'), 'readme');
      const instance = await directorySkill(skillDir);

      await expect(readSkillFileByPath(instance, 'assets/note.txt')).resolves.toMatchObject({ content: 'asset' });
      await expect(readSkillFileByPath(instance, 'README.txt')).resolves.toMatchObject({ content: 'readme' });
    });
  });

  describe('a skill declared in code', () => {
    it('does not serve the files next to the module that declares it', async () => {
      const { root } = await makeWorkspace();
      await writeFile(join(root, 'server.js'), 'module source');
      await mkdir(join(root, 'assets'));
      await writeFile(join(root, 'assets', 'note.txt'), 'not declared');
      const instance = declaredSkill(root);

      await expect(readSkillFileByPath(instance, 'server.js')).rejects.toBeInstanceOf(ResourceNotFoundError);
      await expect(readSkillFileByPath(instance, 'outside/secret.md')).rejects.toBeInstanceOf(ResourceNotFoundError);
      await expect(readSkillFileByPath(instance, 'assets/note.txt')).rejects.toBeInstanceOf(ResourceNotFoundError);
    });

    it('serves the files of a resource directory it declares', async () => {
      const { root } = await makeWorkspace();
      await mkdir(join(root, 'my-assets'));
      await writeFile(join(root, 'my-assets', 'note.txt'), 'declared asset');
      const instance = declaredSkill(root, { assets: './my-assets' });

      await expect(readSkillFileByPath(instance, 'assets/note.txt')).resolves.toMatchObject({
        content: 'declared asset',
      });
    });
  });
});
