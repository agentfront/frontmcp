import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { type Tree, addProjectConfiguration } from '@nx/devkit';
import { pluginGenerator } from './plugin';

describe('plugin generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    addProjectConfiguration(tree, 'my-lib', {
      root: 'libs/my-lib',
      sourceRoot: 'libs/my-lib/src',
      projectType: 'library',
    });
  });

  it('should generate a plugin file', async () => {
    await pluginGenerator(tree, { name: 'cache', project: 'my-lib', skipFormat: true });

    expect(tree.exists('libs/my-lib/src/plugins/cache.plugin.ts')).toBe(true);
  });

  it('should not generate context extension by default', async () => {
    await pluginGenerator(tree, { name: 'cache', project: 'my-lib', skipFormat: true });

    expect(tree.exists('libs/my-lib/src/plugins/cache.context-extension.ts')).toBe(false);
  });

  it('should generate context extension when requested', async () => {
    await pluginGenerator(tree, { name: 'cache', project: 'my-lib', withContextExtension: true, skipFormat: true });

    expect(tree.exists('libs/my-lib/src/plugins/cache.context-extension.ts')).toBe(true);
    const content = tree.read('libs/my-lib/src/plugins/cache.context-extension.ts', 'utf-8');
    expect(content).toContain("declare module '@frontmcp/sdk'");
    expect(content).toContain('installCacheContextExtension');
  });

  it('should use correct class name', async () => {
    await pluginGenerator(tree, { name: 'cache', project: 'my-lib' });

    const content = tree.read('libs/my-lib/src/plugins/cache.plugin.ts', 'utf-8');
    expect(content).toContain('class CachePlugin extends DynamicPlugin');
  });
});
