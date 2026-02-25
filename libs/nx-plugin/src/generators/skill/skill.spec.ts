import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { type Tree, addProjectConfiguration } from '@nx/devkit';
import { skillGenerator } from './skill';

describe('skill generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    addProjectConfiguration(tree, 'my-app', {
      root: 'apps/my-app',
      sourceRoot: 'apps/my-app/src',
      projectType: 'application',
    });
  });

  it('should generate a skill file', async () => {
    await skillGenerator(tree, { name: 'data-analysis', project: 'my-app', skipFormat: true });

    expect(tree.exists('apps/my-app/src/skills/data-analysis.skill.ts')).toBe(true);
  });

  it('should include tool references when provided', async () => {
    await skillGenerator(tree, {
      name: 'data-analysis',
      project: 'my-app',
      tools: 'query, transform',
      skipFormat: true,
    });

    const content = tree.read('apps/my-app/src/skills/data-analysis.skill.ts', 'utf-8');
    expect(content).toContain("'query'");
    expect(content).toContain("'transform'");
  });

  it('should use correct class name', async () => {
    await skillGenerator(tree, { name: 'data-analysis', project: 'my-app' });

    const content = tree.read('apps/my-app/src/skills/data-analysis.skill.ts', 'utf-8');
    expect(content).toContain('class DataAnalysisSkill extends SkillContext');
  });
});
