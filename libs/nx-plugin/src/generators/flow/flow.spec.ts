import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { type Tree, addProjectConfiguration } from '@nx/devkit';
import { flowGenerator } from './flow';

describe('flow generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    addProjectConfiguration(tree, 'my-app', {
      root: 'apps/my-app',
      sourceRoot: 'apps/my-app/src',
      projectType: 'application',
    });
  });

  it('should generate a flow file', async () => {
    await flowGenerator(tree, { name: 'http-request', project: 'my-app', skipFormat: true });

    expect(tree.exists('apps/my-app/src/flows/http-request.flow.ts')).toBe(true);
  });

  it('should use correct class name', async () => {
    await flowGenerator(tree, { name: 'http-request', project: 'my-app', skipFormat: true });

    const content = tree.read('apps/my-app/src/flows/http-request.flow.ts', 'utf-8');
    expect(content).toContain('class HttpRequestFlow extends FlowBase');
  });

  it('should include lifecycle methods', async () => {
    await flowGenerator(tree, { name: 'http-request', project: 'my-app', skipFormat: true });

    const content = tree.read('apps/my-app/src/flows/http-request.flow.ts', 'utf-8');
    expect(content).toContain('async pre()');
    expect(content).toContain('async execute()');
    expect(content).toContain('async post()');
    expect(content).toContain('async finalize()');
    expect(content).toContain('async error(');
  });

  it('should generate in subdirectory', async () => {
    await flowGenerator(tree, { name: 'http-request', project: 'my-app', directory: 'custom' });

    expect(tree.exists('apps/my-app/src/flows/custom/http-request.flow.ts')).toBe(true);
  });
});
