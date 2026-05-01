import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';

import { skillDirGenerator } from './skill-dir';

describe('skill-dir generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    addProjectConfiguration(tree, 'my-app', {
      root: 'apps/my-app',
      sourceRoot: 'apps/my-app/src',
      projectType: 'application',
    });
  });

  it('generates a skill directory with SKILL.md from templates', async () => {
    await skillDirGenerator(tree, {
      name: 'data-analysis',
      project: 'my-app',
      skipFormat: true,
    });
    expect(tree.exists('apps/my-app/skills/data-analysis/SKILL.md')).toBe(true);
  });

  it('uses the provided description in the template', async () => {
    await skillDirGenerator(tree, {
      name: 'data-analysis',
      project: 'my-app',
      description: 'Custom description for this skill',
      skipFormat: true,
    });
    const content = tree.read('apps/my-app/skills/data-analysis/SKILL.md', 'utf-8');
    expect(content).toContain('Custom description for this skill');
  });

  it('falls back to a default description when none is provided', async () => {
    await skillDirGenerator(tree, { name: 'analytics', project: 'my-app', skipFormat: true });
    const content = tree.read('apps/my-app/skills/analytics/SKILL.md', 'utf-8');
    expect(content).toContain('Skill: analytics');
  });

  it('parses comma-separated tags into a comma-space joined list', async () => {
    await skillDirGenerator(tree, {
      name: 'a',
      project: 'my-app',
      tags: 'foo, bar,baz',
      skipFormat: true,
    });
    const content = tree.read('apps/my-app/skills/a/SKILL.md', 'utf-8');
    expect(content).toContain('foo, bar, baz');
  });

  it('falls back to the skill name as the tag when none provided', async () => {
    await skillDirGenerator(tree, { name: 'analytics', project: 'my-app', skipFormat: true });
    const content = tree.read('apps/my-app/skills/analytics/SKILL.md', 'utf-8');
    expect(content).toContain('analytics');
  });

  it('honors a custom directory', async () => {
    await skillDirGenerator(tree, {
      name: 'foo',
      project: 'my-app',
      directory: 'custom/skills',
      skipFormat: true,
    });
    expect(tree.exists('apps/my-app/custom/skills/foo/SKILL.md')).toBe(true);
  });

  it('creates a references/ directory with .gitkeep when requested', async () => {
    await skillDirGenerator(tree, {
      name: 'foo',
      project: 'my-app',
      withReferences: true,
      skipFormat: true,
    });
    expect(tree.exists('apps/my-app/skills/foo/references/.gitkeep')).toBe(true);
  });

  it('does not create references/ when not requested', async () => {
    await skillDirGenerator(tree, {
      name: 'foo',
      project: 'my-app',
      skipFormat: true,
    });
    expect(tree.exists('apps/my-app/skills/foo/references/.gitkeep')).toBe(false);
  });

  it('runs prettier formatting when skipFormat is not set', async () => {
    await skillDirGenerator(tree, { name: 'fmt', project: 'my-app' });
    // Just verify it didn't throw and the file was generated
    expect(tree.exists('apps/my-app/skills/fmt/SKILL.md')).toBe(true);
  });

  it('exposes the generator as default export', async () => {
    const mod = await import('./skill-dir');
    expect(mod.default).toBe(skillDirGenerator);
  });
});
