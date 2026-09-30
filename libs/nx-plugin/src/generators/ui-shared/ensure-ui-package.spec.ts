import { readJson, type Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';

import { getFrontmcpVersion } from '../../utils/versions';
import { uiComponentGenerator } from '../ui-component/ui-component';
import { uiPageGenerator } from '../ui-page/ui-page';
import { uiShellGenerator } from '../ui-shell/ui-shell';
import { ensureUiPackage } from './ensure-ui-package';

describe('ensureUiPackage', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('creates the package as an Nx project when the workspace has none', () => {
    ensureUiPackage(tree, { packageRoot: 'ui/components', projectName: 'ui-components', kind: 'react' });

    const project = readJson(tree, 'ui/components/project.json');
    expect(project.name).toBe('ui-components');
    expect(project.sourceRoot).toBe('ui/components/src');
    expect(tree.exists('ui/components/src/index.ts')).toBe(true);
    expect(readJson(tree, 'ui/components/tsconfig.json').compilerOptions.jsx).toBe('react-jsx');
    expect(readJson(tree, 'ui/components/tsconfig.json').extends).toBe('../../tsconfig.base.json');
    expect(tree.read('ui/components/jest.config.cjs', 'utf-8')).toContain("testEnvironment: 'jsdom'");
  });

  it('leaves an existing package untouched', () => {
    tree.write('ui/components/project.json', JSON.stringify({ name: 'custom' }));
    tree.write('ui/components/src/index.ts', 'export {};');

    ensureUiPackage(tree, { packageRoot: 'ui/components', projectName: 'ui-components', kind: 'react' });

    expect(readJson(tree, 'ui/components/project.json')).toEqual({ name: 'custom' });
    expect(tree.exists('ui/components/tsconfig.json')).toBe(false);
    expect(tree.read('ui/components/src/index.ts', 'utf-8')).toBe('export {};');
  });

  it('uses the node test environment and no JSX for shell packages', () => {
    ensureUiPackage(tree, { packageRoot: 'ui/shells', projectName: 'ui-shells', kind: 'shell' });

    expect(readJson(tree, 'ui/shells/tsconfig.json').compilerOptions.jsx).toBeUndefined();
    expect(tree.read('ui/shells/jest.config.cjs', 'utf-8')).toContain("testEnvironment: 'node'");
  });
});

describe('UI generators install what the generated code imports', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it.each([
    ['ui-component', () => uiComponentGenerator(tree, { name: 'LoginForm', skipFormat: true })],
    ['ui-page', () => uiPageGenerator(tree, { name: 'Dashboard', skipFormat: true })],
  ])('%s adds React, MUI and testing-library', async (_name, run) => {
    await run();

    const pkg = readJson(tree, 'package.json');
    expect(pkg.dependencies['react']).toBeDefined();
    expect(pkg.dependencies['react-dom']).toBeDefined();
    expect(pkg.dependencies['@mui/material']).toBeDefined();
    expect(pkg.dependencies['@emotion/react']).toBeDefined();
    expect(pkg.dependencies['@emotion/styled']).toBeDefined();
    expect(pkg.devDependencies['@types/react']).toBeDefined();
    expect(pkg.devDependencies['@testing-library/react']).toBeDefined();
    expect(pkg.devDependencies['jest-environment-jsdom']).toBeDefined();
  });

  it('ui-shell adds @frontmcp/uipack at the plugin version', async () => {
    await uiShellGenerator(tree, { name: 'admin', skipFormat: true });

    expect(readJson(tree, 'package.json').dependencies['@frontmcp/uipack']).toBe(`~${getFrontmcpVersion()}`);
  });

  it('generates a shell spec that reads the html of the ShellResult', async () => {
    await uiShellGenerator(tree, { name: 'admin', skipFormat: true });

    const spec = tree.read('ui/shells/src/admin/admin.shell.spec.ts', 'utf-8') ?? '';
    expect(spec).toContain('result.html');
  });

  it('bootstraps the package so the entry is registered in a real project', async () => {
    await uiComponentGenerator(tree, { name: 'LoginForm', skipFormat: true });

    expect(tree.exists('ui/components/project.json')).toBe(true);
    expect(tree.read('ui/components/src/index.ts', 'utf-8')).toContain("from './LoginForm'");
    expect(readJson(tree, 'tsconfig.base.json').compilerOptions.paths['@frontmcp/ui-components/LoginForm']).toEqual([
      'ui/components/src/LoginForm/index.ts',
    ]);
  });
});
