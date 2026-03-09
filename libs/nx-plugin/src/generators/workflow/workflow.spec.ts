import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { type Tree, addProjectConfiguration } from '@nx/devkit';
import { workflowGenerator } from './workflow';

describe('workflow generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    addProjectConfiguration(tree, 'my-app', {
      root: 'apps/my-app',
      sourceRoot: 'apps/my-app/src',
      projectType: 'application',
    });
  });

  it('should generate a workflow file', async () => {
    await workflowGenerator(tree, { name: 'onboarding', project: 'my-app', skipFormat: true });

    expect(tree.exists('apps/my-app/src/workflows/onboarding.workflow.ts')).toBe(true);
  });

  it('should use correct class name', async () => {
    await workflowGenerator(tree, { name: 'onboarding', project: 'my-app', skipFormat: true });

    const content = tree.read('apps/my-app/src/workflows/onboarding.workflow.ts', 'utf-8');
    expect(content).toContain('class OnboardingWorkflow');
    expect(content).toContain("name: 'onboarding'");
  });

  it('should generate in subdirectory when specified', async () => {
    await workflowGenerator(tree, {
      name: 'onboarding',
      project: 'my-app',
      directory: 'automated',
      skipFormat: true,
    });

    expect(tree.exists('apps/my-app/src/workflows/automated/onboarding.workflow.ts')).toBe(true);
  });

  it('should throw when project does not exist', async () => {
    await expect(workflowGenerator(tree, { name: 'onboarding', project: 'non-existent' })).rejects.toThrow(
      'Project "non-existent" not found',
    );
  });

  it('should handle kebab-case names', async () => {
    await workflowGenerator(tree, { name: 'user-onboarding', project: 'my-app', skipFormat: true });

    expect(tree.exists('apps/my-app/src/workflows/user-onboarding.workflow.ts')).toBe(true);
    const content = tree.read('apps/my-app/src/workflows/user-onboarding.workflow.ts', 'utf-8');
    expect(content).toContain('class UserOnboardingWorkflow');
  });

  it('should call formatFiles when skipFormat is not set', async () => {
    await expect(workflowGenerator(tree, { name: 'onboarding', project: 'my-app' })).resolves.not.toThrow();
  });

  it('should export default', async () => {
    const mod = await import('./workflow');
    expect(mod.default).toBe(workflowGenerator);
  });
});
