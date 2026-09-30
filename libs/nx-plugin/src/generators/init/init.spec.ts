import { readJson, updateJson, writeJson, type Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';

import { getFrontmcpVersion } from '../../utils/versions';
import { initGenerator } from './init';

describe('init generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('installs the FrontMCP packages the executors and generated code need', async () => {
    await initGenerator(tree, { skipFormat: true });

    const pkg = readJson(tree, 'package.json');
    const range = `~${getFrontmcpVersion()}`;
    expect(pkg.dependencies['@frontmcp/sdk']).toBe(range);
    expect(pkg.dependencies['frontmcp']).toBe(range);
    expect(pkg.dependencies['reflect-metadata']).toBeDefined();
    expect(pkg.dependencies['zod']).toBeDefined();
    expect(pkg.devDependencies['@frontmcp/testing']).toBe(range);
    expect(pkg.devDependencies['jest']).toBeDefined();
    expect(pkg.devDependencies['@swc/jest']).toBeDefined();
  });

  it('does not overwrite versions the workspace already pins', async () => {
    updateJson(tree, 'package.json', (json) => {
      json.dependencies = { ...json.dependencies, zod: '^4.5.0' };
      json.devDependencies = { ...json.devDependencies, jest: '^29.0.0' };
      return json;
    });

    await initGenerator(tree, { skipFormat: true });

    const pkg = readJson(tree, 'package.json');
    expect(pkg.dependencies['zod']).toBe('^4.5.0');
    expect(pkg.devDependencies['jest']).toBe('^29.0.0');
  });

  it('skips package.json when asked to', async () => {
    const before = readJson(tree, 'package.json');
    await initGenerator(tree, { skipPackageJson: true, skipFormat: true });
    expect(readJson(tree, 'package.json')).toEqual(before);
  });

  it('makes the build and test executors cacheable', async () => {
    writeJson(tree, 'nx.json', { namedInputs: { production: ['default'] }, targetDefaults: {} });

    await initGenerator(tree, { skipFormat: true });

    const { targetDefaults } = readJson(tree, 'nx.json');
    expect(targetDefaults['@frontmcp/nx:build']).toEqual({
      cache: true,
      dependsOn: ['^build'],
      inputs: ['production', '^production'],
    });
    expect(targetDefaults['@frontmcp/nx:build-exec'].cache).toBe(true);
    expect(targetDefaults['@frontmcp/nx:test'].cache).toBe(true);
    expect(targetDefaults['@frontmcp/nx:dev']).toBeUndefined();
    expect(targetDefaults['@frontmcp/nx:serve']).toBeUndefined();
  });

  it('does not reference a production input the workspace does not define', async () => {
    writeJson(tree, 'nx.json', { targetDefaults: {} });

    await initGenerator(tree, { skipFormat: true });

    expect(readJson(tree, 'nx.json').targetDefaults['@frontmcp/nx:build'].inputs).toBeUndefined();
  });

  it('keeps target defaults the workspace already customised', async () => {
    writeJson(tree, 'nx.json', { targetDefaults: { '@frontmcp/nx:build': { cache: false } } });

    await initGenerator(tree, { skipFormat: true });

    expect(readJson(tree, 'nx.json').targetDefaults['@frontmcp/nx:build'].cache).toBe(false);
  });

  it('is idempotent', async () => {
    await initGenerator(tree, { skipFormat: true });
    const first = readJson(tree, 'nx.json');
    await initGenerator(tree, { skipFormat: true });
    expect(readJson(tree, 'nx.json')).toEqual(first);
  });
});
