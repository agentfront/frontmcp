import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { type Tree, readJson } from '@nx/devkit';
import { addFrontmcpDependencies } from './add-dependencies';

describe('addFrontmcpDependencies', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('should add dependencies to package.json', () => {
    const callback = addFrontmcpDependencies(tree, { '@frontmcp/sdk': '~0.11.1' }, { '@frontmcp/testing': '~0.11.1' });

    const packageJson = readJson(tree, 'package.json');
    expect(packageJson.dependencies['@frontmcp/sdk']).toBe('~0.11.1');
    expect(packageJson.devDependencies['@frontmcp/testing']).toBe('~0.11.1');
    expect(typeof callback).toBe('function');
  });

  it('should default devDependencies to empty', () => {
    addFrontmcpDependencies(tree, { '@frontmcp/sdk': '~0.11.1' });

    const packageJson = readJson(tree, 'package.json');
    expect(packageJson.dependencies['@frontmcp/sdk']).toBe('~0.11.1');
  });
});
