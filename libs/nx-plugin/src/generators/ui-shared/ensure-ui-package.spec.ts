import { readJson, readNxJson, updateNxJson, type Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';

import { getEsbuildVersion, getFrontmcpVersion, getNxVersion } from '../../utils/versions';
import { uiComponentGenerator } from '../ui-component/ui-component';
import { uiPageGenerator } from '../ui-page/ui-page';
import { uiShellGenerator } from '../ui-shell/ui-shell';
import { addUiEntry } from './add-ui-entry';
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

  it('sets commonjs/node10 unless the base config needs modern resolution', () => {
    ensureUiPackage(tree, { packageRoot: 'ui/components', projectName: 'ui-components', kind: 'react' });

    expect(readJson(tree, 'ui/components/tsconfig.json').compilerOptions).toMatchObject({
      module: 'commonjs',
      moduleResolution: 'node10',
    });
  });

  it('resolves with bundler on TypeScript 6, which deprecates node10', () => {
    tree.write('package.json', JSON.stringify({ devDependencies: { typescript: '~6.0.3' } }));
    ensureUiPackage(tree, { packageRoot: 'ui/shells', projectName: 'ui-shells', kind: 'shell' });

    expect(readJson(tree, 'ui/shells/tsconfig.json').compilerOptions).toMatchObject({
      module: 'commonjs',
      moduleResolution: 'bundler',
    });
    expect(readJson(tree, 'ui/shells/tsconfig.json').compilerOptions.ignoreDeprecations).toBeUndefined();
  });

  it('inherits module and moduleResolution when the base config sets customConditions (TS5098)', () => {
    tree.write(
      'tsconfig.base.json',
      JSON.stringify({
        compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', customConditions: ['@ws/source'] },
      }),
    );
    ensureUiPackage(tree, { packageRoot: 'ui/components', projectName: 'ui-components', kind: 'react' });

    const { compilerOptions } = readJson(tree, 'ui/components/tsconfig.json');
    expect(compilerOptions.module).toBeUndefined();
    expect(compilerOptions.moduleResolution).toBeUndefined();
    expect(compilerOptions.ignoreDeprecations).toBeUndefined();
    expect(compilerOptions.jsx).toBe('react-jsx');
  });

  it('gives a new package build targets that addUiEntry can extend', () => {
    ensureUiPackage(tree, { packageRoot: 'ui/components', projectName: 'ui-components', kind: 'react' });

    const { targets } = readJson(tree, 'ui/components/project.json');
    expect(targets['build-cjs']).toMatchObject({
      executor: '@nx/esbuild:esbuild',
      options: { main: 'ui/components/src/index.ts', tsConfig: 'ui/components/tsconfig.json', format: ['cjs'] },
    });
    expect(targets['build-esm'].dependsOn).toEqual(['build-cjs']);
    expect(targets.build.dependsOn).toEqual(['build-cjs', 'build-esm']);

    addUiEntry(tree, { packageRoot: 'ui/components', entryName: 'LoginForm', importPath: '@acme/ui-components' });
    const updated = readJson(tree, 'ui/components/project.json').targets;
    expect(updated['build-cjs'].options.additionalEntryPoints).toContain('ui/components/src/LoginForm/index.ts');
    expect(updated['build-esm'].options.additionalEntryPoints).toContain('ui/components/src/LoginForm/index.ts');
  });

  it('installs the esbuild builder and the DOM testing library peer', () => {
    ensureUiPackage(tree, { packageRoot: 'ui/components', projectName: 'ui-components', kind: 'react' });
    ensureUiPackage(tree, { packageRoot: 'ui/shells', projectName: 'ui-shells', kind: 'shell' });

    const dev = readJson(tree, 'package.json').devDependencies;
    expect(dev['@testing-library/dom']).toBeDefined();
    expect(dev['@nx/esbuild']).toBeDefined();
    // @frontmcp/uipack peers on esbuild >=0.27; an older range made `npm install` fail with ERESOLVE.
    expect(dev.esbuild).toBe(getEsbuildVersion());
  });

  describe('an esbuild range already in package.json', () => {
    // Earlier versions of these generators wrote `^0.25.0`, below the `>=0.27` peer range of @frontmcp/uipack.
    it.each([
      ['devDependencies', '^0.25.0'],
      ['dependencies', '~0.19.12'],
    ])('is raised when it is older (%s: %s), in the section it is in', (section, existing) => {
      tree.write('package.json', JSON.stringify({ [section]: { esbuild: existing } }));

      ensureUiPackage(tree, { packageRoot: 'ui/shells', projectName: 'ui-shells', kind: 'shell' });

      const pkg = readJson(tree, 'package.json');
      expect(pkg[section].esbuild).toBe(getEsbuildVersion());
      const other = section === 'dependencies' ? 'devDependencies' : 'dependencies';
      expect(pkg[other]?.esbuild).toBeUndefined();
    });

    it('is kept when it is the same or newer', () => {
      tree.write('package.json', JSON.stringify({ devDependencies: { esbuild: '^0.28.0' } }));

      ensureUiPackage(tree, { packageRoot: 'ui/shells', projectName: 'ui-shells', kind: 'shell' });

      expect(readJson(tree, 'package.json').devDependencies.esbuild).toBe('^0.28.0');
    });

    it('is raised for React packages too, without touching the other existing ranges', () => {
      tree.write(
        'package.json',
        JSON.stringify({
          dependencies: { react: '^18.3.0' },
          devDependencies: { esbuild: '^0.25.0', '@nx/esbuild': '22.0.0' },
        }),
      );

      ensureUiPackage(tree, { packageRoot: 'ui/components', projectName: 'ui-components', kind: 'react' });

      const pkg = readJson(tree, 'package.json');
      expect(pkg.devDependencies.esbuild).toBe(getEsbuildVersion());
      expect(pkg.devDependencies['@nx/esbuild']).toBe('22.0.0');
      expect(pkg.dependencies.react).toBe('^18.3.0');
    });
  });

  describe('in an Nx TypeScript-solution workspace (#768)', () => {
    it('skips the type check of build-esm, which runs it without composite (TS5069)', () => {
      ensureUiPackage(tree, { packageRoot: 'ui/shells', projectName: 'ui-shells', kind: 'shell' });

      const { targets } = readJson(tree, 'ui/shells/project.json');
      expect(targets['build-esm'].options.skipTypeCheck).toBe(true);
      expect(targets['build-cjs'].options.skipTypeCheck).toBeUndefined();
    });

    it('adds a test target that runs the generated jest config when no plugin infers one', () => {
      ensureUiPackage(tree, { packageRoot: 'ui/shells', projectName: 'ui-shells', kind: 'shell' });

      expect(readJson(tree, 'ui/shells/project.json').targets.test).toEqual({
        executor: 'nx:run-commands',
        cache: true,
        options: { command: 'jest --config jest.config.cjs', cwd: 'ui/shells' },
      });
      expect(readJson(tree, 'package.json').devDependencies['@swc/jest']).toBeDefined();
    });

    it('leaves the test target to @nx/jest/plugin when the workspace registers it', () => {
      const nxJson = readNxJson(tree) ?? {};
      updateNxJson(tree, { ...nxJson, plugins: [{ plugin: '@nx/jest/plugin', options: { targetName: 'test' } }] });

      ensureUiPackage(tree, { packageRoot: 'ui/shells', projectName: 'ui-shells', kind: 'shell' });

      expect(readJson(tree, 'ui/shells/project.json').targets.test).toBeUndefined();
    });

    it('leaves the test target to @nx/jest/plugin registered without options', () => {
      const nxJson = readNxJson(tree) ?? {};
      updateNxJson(tree, { ...nxJson, plugins: ['@nx/jest/plugin'] });

      ensureUiPackage(tree, { packageRoot: 'ui/shells', projectName: 'ui-shells', kind: 'shell' });

      expect(readJson(tree, 'ui/shells/project.json').targets.test).toBeUndefined();
    });

    it('adds a test target when @nx/jest/plugin infers its target under another name', () => {
      const nxJson = readNxJson(tree) ?? {};
      updateNxJson(tree, { ...nxJson, plugins: [{ plugin: '@nx/jest/plugin', options: { targetName: 'unit' } }] });

      ensureUiPackage(tree, { packageRoot: 'ui/shells', projectName: 'ui-shells', kind: 'shell' });

      expect(readJson(tree, 'ui/shells/project.json').targets.test).toBeDefined();
    });

    it("installs @nx/esbuild at the workspace's Nx version", () => {
      tree.write('package.json', JSON.stringify({ devDependencies: { nx: '23.2.0' } }));

      ensureUiPackage(tree, { packageRoot: 'ui/shells', projectName: 'ui-shells', kind: 'shell' });

      expect(readJson(tree, 'package.json').devDependencies['@nx/esbuild']).toBe('23.2.0');
    });

    it('falls back to the plugin Nx version when the workspace declares none', () => {
      ensureUiPackage(tree, { packageRoot: 'ui/shells', projectName: 'ui-shells', kind: 'shell' });

      expect(readJson(tree, 'package.json').devDependencies['@nx/esbuild']).toBe(getNxVersion());
    });
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
      './ui/components/src/LoginForm/index.ts',
    ]);
  });
});
