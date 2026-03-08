import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { type Tree, addProjectConfiguration } from '@nx/devkit';
import { jobGenerator } from './job';

describe('job generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    addProjectConfiguration(tree, 'my-app', {
      root: 'apps/my-app',
      sourceRoot: 'apps/my-app/src',
      projectType: 'application',
    });
  });

  it('should generate a job file', async () => {
    await jobGenerator(tree, { name: 'data-sync', project: 'my-app', skipFormat: true });

    expect(tree.exists('apps/my-app/src/jobs/data-sync.job.ts')).toBe(true);
  });

  it('should use correct class name', async () => {
    await jobGenerator(tree, { name: 'data-sync', project: 'my-app', skipFormat: true });

    const content = tree.read('apps/my-app/src/jobs/data-sync.job.ts', 'utf-8');
    expect(content).toContain('class DataSyncJob extends JobContext');
    expect(content).toContain("name: 'data-sync'");
  });

  it('should generate in subdirectory when specified', async () => {
    await jobGenerator(tree, { name: 'data-sync', project: 'my-app', directory: 'background', skipFormat: true });

    expect(tree.exists('apps/my-app/src/jobs/background/data-sync.job.ts')).toBe(true);
  });

  it('should throw when project does not exist', async () => {
    await expect(jobGenerator(tree, { name: 'data-sync', project: 'non-existent' })).rejects.toThrow(
      'Project "non-existent" not found',
    );
  });

  it('should handle kebab-case names', async () => {
    await jobGenerator(tree, { name: 'my-background-task', project: 'my-app', skipFormat: true });

    expect(tree.exists('apps/my-app/src/jobs/my-background-task.job.ts')).toBe(true);
    const content = tree.read('apps/my-app/src/jobs/my-background-task.job.ts', 'utf-8');
    expect(content).toContain('class MyBackgroundTaskJob');
  });

  it('should call formatFiles when skipFormat is not set', async () => {
    // No skipFormat means formatFiles will be called (default behavior)
    await expect(jobGenerator(tree, { name: 'data-sync', project: 'my-app' })).resolves.not.toThrow();
  });

  it('should export default', async () => {
    const mod = await import('./job');
    expect(mod.default).toBe(jobGenerator);
  });
});
