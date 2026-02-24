import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { type Tree, addProjectConfiguration } from '@nx/devkit';
import { providerGenerator } from './provider';

describe('provider generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    addProjectConfiguration(tree, 'my-app', {
      root: 'apps/my-app',
      sourceRoot: 'apps/my-app/src',
      projectType: 'application',
    });
  });

  it('should generate a provider file', async () => {
    await providerGenerator(tree, { name: 'database', project: 'my-app', skipFormat: true });

    expect(tree.exists('apps/my-app/src/providers/database.provider.ts')).toBe(true);
  });

  it('should use singleton scope by default', async () => {
    await providerGenerator(tree, { name: 'database', project: 'my-app', skipFormat: true });

    const content = tree.read('apps/my-app/src/providers/database.provider.ts', 'utf-8');
    expect(content).toContain("scope: 'singleton'");
  });

  it('should use specified scope', async () => {
    await providerGenerator(tree, { name: 'database', project: 'my-app', scope: 'request', skipFormat: true });

    const content = tree.read('apps/my-app/src/providers/database.provider.ts', 'utf-8');
    expect(content).toContain("scope: 'request'");
  });

  it('should generate token with CONSTANT_CASE', async () => {
    await providerGenerator(tree, { name: 'database', project: 'my-app', skipFormat: true });

    const content = tree.read('apps/my-app/src/providers/database.provider.ts', 'utf-8');
    expect(content).toContain('DATABASE_TOKEN');
  });

  it('should use correct class name', async () => {
    await providerGenerator(tree, { name: 'my-database', project: 'my-app' });

    const content = tree.read('apps/my-app/src/providers/my-database.provider.ts', 'utf-8');
    expect(content).toContain('class MyDatabaseProvider');
  });
});
