import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { type Tree, addProjectConfiguration } from '@nx/devkit';
import { adapterGenerator } from './adapter';

describe('adapter generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    addProjectConfiguration(tree, 'my-lib', {
      root: 'libs/my-lib',
      sourceRoot: 'libs/my-lib/src',
      projectType: 'library',
    });
  });

  it('should generate an adapter file', async () => {
    await adapterGenerator(tree, { name: 'openapi', project: 'my-lib', skipFormat: true });

    expect(tree.exists('libs/my-lib/src/adapters/openapi.adapter.ts')).toBe(true);
  });

  it('should use correct class name', async () => {
    await adapterGenerator(tree, { name: 'openapi', project: 'my-lib', skipFormat: true });

    const content = tree.read('libs/my-lib/src/adapters/openapi.adapter.ts', 'utf-8');
    expect(content).toContain('class OpenapiAdapter extends DynamicAdapter');
    expect(content).toContain('OpenapiAdapterOptions');
  });

  it('should generate in subdirectory', async () => {
    await adapterGenerator(tree, { name: 'openapi', project: 'my-lib', directory: 'external' });

    expect(tree.exists('libs/my-lib/src/adapters/external/openapi.adapter.ts')).toBe(true);
  });
});
