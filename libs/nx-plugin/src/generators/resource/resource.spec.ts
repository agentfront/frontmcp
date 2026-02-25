import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { type Tree, addProjectConfiguration } from '@nx/devkit';
import { resourceGenerator } from './resource';

describe('resource generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    addProjectConfiguration(tree, 'my-app', {
      root: 'apps/my-app',
      sourceRoot: 'apps/my-app/src',
      projectType: 'application',
    });
  });

  it('should generate a static resource', async () => {
    await resourceGenerator(tree, { name: 'users', project: 'my-app', skipFormat: true });

    expect(tree.exists('apps/my-app/src/resources/users.resource.ts')).toBe(true);
    const content = tree.read('apps/my-app/src/resources/users.resource.ts', 'utf-8');
    expect(content).toContain('@Resource(');
    expect(content).toContain('class UsersResource extends ResourceContext');
  });

  it('should generate a resource template when template=true', async () => {
    await resourceGenerator(tree, { name: 'users', project: 'my-app', template: true });

    const content = tree.read('apps/my-app/src/resources/users.resource.ts', 'utf-8');
    expect(content).toContain('@ResourceTemplate(');
    expect(content).toContain('uriTemplate:');
  });

  it('should throw when project does not exist', async () => {
    await expect(resourceGenerator(tree, { name: 'users', project: 'non-existent' })).rejects.toThrow(
      'Project "non-existent" not found',
    );
  });
});
