/**
 * Which files `skill://<skill>/<file>` serves: a skill directory's own files, and a skill declared in
 * code only the resource directories it declares. A link never serves a file outside them.
 */

import 'reflect-metadata';

import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
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
async function makeWorkspace(): Promise<{ root: string; skillDir: string; outsideFile: string }> {
  const root = await mkdtemp(join(tmpdir(), 'skill-file-'));
  const skillDir = join(root, 'my-skill');
  await mkdir(join(root, 'outside'), { recursive: true });
  const outsideFile = join(root, 'outside', 'secret.md');
  await writeFile(outsideFile, '# Outside\n\nnot part of any skill');
  await mkdir(skillDir, { recursive: true });
  return { root, skillDir, outsideFile };
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
  return createSkillInstance(
    { kind: SkillKind.VALUE, provide: Symbol('skill'), metadata, callerDir },
    providers,
    owner,
  );
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

    it('serves a link that stays inside the skill directory', async () => {
      const { skillDir } = await makeWorkspace();
      await mkdir(join(skillDir, 'assets'));
      await writeFile(join(skillDir, 'assets', 'note.txt'), 'asset');
      await symlink(join(skillDir, 'assets', 'note.txt'), join(skillDir, 'alias.txt'));
      const instance = await directorySkill(skillDir);

      await expect(readSkillFileByPath(instance, 'alias.txt')).resolves.toMatchObject({ content: 'asset' });
    });

    it('does not serve a top-level link to a file outside the skill directory', async () => {
      const { skillDir, outsideFile } = await makeWorkspace();
      await symlink(outsideFile, join(skillDir, 'notes.txt'));
      const instance = await directorySkill(skillDir);

      await expect(readSkillFileByPath(instance, 'notes.txt')).rejects.toBeInstanceOf(ResourceNotFoundError);
    });

    it('does not serve a link in a resource directory to a file outside the skill directory', async () => {
      const { skillDir, outsideFile } = await makeWorkspace();
      await mkdir(join(skillDir, 'assets'));
      await symlink(outsideFile, join(skillDir, 'assets', 'logo.txt'));
      const instance = await directorySkill(skillDir);

      await expect(readSkillFileByPath(instance, 'assets/logo.txt')).rejects.toBeInstanceOf(ResourceNotFoundError);
    });

    it('does not serve a reference that links to a file outside the skill directory', async () => {
      const { skillDir, outsideFile } = await makeWorkspace();
      await mkdir(join(skillDir, 'references'));
      await writeFile(join(skillDir, 'references', 'guide.md'), '# Guide\n\ninside');
      await symlink(outsideFile, join(skillDir, 'references', 'secret.md'));
      const instance = await directorySkill(skillDir);

      await expect(readSkillFileByPath(instance, 'references/guide.md')).resolves.toMatchObject({
        content: '# Guide\n\ninside',
      });
      await expect(readSkillFileByPath(instance, 'references/secret.md')).rejects.toBeInstanceOf(ResourceNotFoundError);
    });

    it('does not serve a resource directory its SKILL.md names outside the skill directory', async () => {
      const { root, skillDir } = await makeWorkspace();
      const instance = await directorySkill(skillDir, `resources:\n  assets: ${join(root, 'outside')}\n`);

      await expect(readSkillFileByPath(instance, 'assets/secret.md')).rejects.toBeInstanceOf(ResourceNotFoundError);
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

    it('serves the files of a resource directory it declares, but no link out of it', async () => {
      const { root, outsideFile } = await makeWorkspace();
      await mkdir(join(root, 'my-assets'));
      await writeFile(join(root, 'my-assets', 'note.txt'), 'declared asset');
      await symlink(outsideFile, join(root, 'my-assets', 'linked.md'));
      const instance = declaredSkill(root, { assets: './my-assets' });

      await expect(readSkillFileByPath(instance, 'assets/note.txt')).resolves.toMatchObject({
        content: 'declared asset',
      });
      await expect(readSkillFileByPath(instance, 'assets/linked.md')).rejects.toBeInstanceOf(ResourceNotFoundError);
    });
  });
});
