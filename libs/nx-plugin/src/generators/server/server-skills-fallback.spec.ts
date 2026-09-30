import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';

describe('server generator without a usable skills catalog', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('@frontmcp/skills');
  });

  async function generate(): Promise<boolean> {
    const { serverGenerator } = await import('./server');
    const tree = createTreeWithEmptyWorkspace();
    await serverGenerator(tree, { name: 'prod', apps: 'demo', deploymentTarget: 'node', skipFormat: true });
    return tree.exists('servers/prod/src/main.ts');
  }

  it('still scaffolds the server when @frontmcp/skills cannot be loaded', async () => {
    jest.resetModules();
    jest.doMock('@frontmcp/skills', () => {
      throw new Error('module not found');
    });
    expect(await generate()).toBe(true);
  });

  it('still scaffolds the server when the manifest cannot be read', async () => {
    jest.resetModules();
    jest.doMock('@frontmcp/skills', () => ({
      loadManifest: () => {
        throw new Error('bad manifest');
      },
    }));
    expect(await generate()).toBe(true);
  });
});
