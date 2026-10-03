import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { readJson } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';

import {
  addTsPathAlias,
  getModuleResolution,
  getProjectTsOptions,
  getTypeScriptMajor,
  resolveProjectPaths,
} from './project-paths';

describe('resolveProjectPaths', () => {
  it('computes the offset from the directory depth', () => {
    expect(resolveProjectPaths('apps/demo')).toEqual({ projectRoot: 'apps/demo', offset: '../../' });
    expect(resolveProjectPaths('apps/team/platform/demo')).toEqual({
      projectRoot: 'apps/team/platform/demo',
      offset: '../../../../',
    });
  });

  it('drops the folder the workspace generator scaffolds into', () => {
    expect(resolveProjectPaths('my-project/apps/demo', 'my-project')).toEqual({
      projectRoot: 'apps/demo',
      offset: '../../',
    });
  });

  it('normalizes separators, leading ./ and trailing slashes', () => {
    expect(resolveProjectPaths('.\\apps\\demo\\').projectRoot).toBe('apps/demo');
    expect(resolveProjectPaths('./my-project/apps/demo/', './my-project/').projectRoot).toBe('apps/demo');
  });

  it('strips long runs of trailing slashes without backtracking', () => {
    const start = Date.now();
    expect(resolveProjectPaths(`apps/demo${'/'.repeat(100000)}`).projectRoot).toBe('apps/demo');
    expect(resolveProjectPaths('/'.repeat(100000)).projectRoot).toBe('');
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('keeps the directory when it is outside the given workspace folder', () => {
    expect(resolveProjectPaths('other/apps/demo', 'my-project').projectRoot).toBe('other/apps/demo');
  });
});

describe('getTypeScriptMajor / getModuleResolution', () => {
  function withTypescript(range?: string, key: 'devDependencies' | 'dependencies' = 'devDependencies', root = '') {
    const tree = createTreeWithEmptyWorkspace();
    const path = root ? `${root}/package.json` : 'package.json';
    tree.write(path, JSON.stringify(range ? { [key]: { typescript: range } } : {}));
    return tree;
  }

  it('keeps node10 for TypeScript 5, which rejects bundler with CommonJS (TS5095)', () => {
    expect(getTypeScriptMajor(withTypescript('~5.9.2'))).toBe(5);
    expect(getModuleResolution(withTypescript('~5.9.2'))).toBe('node10');
  });

  it('uses bundler for TypeScript 6+, which deprecates node10 (TS5107)', () => {
    expect(getModuleResolution(withTypescript('~6.0.3'))).toBe('bundler');
    expect(getModuleResolution(withTypescript('^7.0.0', 'dependencies'))).toBe('bundler');
  });

  it('reads the workspace package.json below the tree root', () => {
    expect(getModuleResolution(withTypescript('~6.0.3', 'devDependencies', 'my-project'), 'my-project')).toBe(
      'bundler',
    );
  });

  it('falls back to node10 when TypeScript is not declared', () => {
    expect(getTypeScriptMajor(withTypescript())).toBeUndefined();
    expect(getModuleResolution(withTypescript('latest'))).toBe('node10');
  });

  describe('installed typescript', () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'nx-plugin-ts-'));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    function installTypescript(content: string) {
      mkdirSync(join(dir, 'node_modules', 'typescript'), { recursive: true });
      writeFileSync(join(dir, 'node_modules', 'typescript', 'package.json'), content);
      const tree = createTreeWithEmptyWorkspace();
      tree.root = dir;
      return tree;
    }

    it('prefers the installed compiler over the declared range', () => {
      const tree = installTypescript(JSON.stringify({ version: '6.0.3' }));
      tree.write('package.json', JSON.stringify({ devDependencies: { typescript: '~5.9.2' } }));
      expect(getModuleResolution(tree)).toBe('bundler');
    });

    it('reports node10 for an installed TypeScript 5', () => {
      expect(getModuleResolution(installTypescript(JSON.stringify({ version: '5.9.3' })))).toBe('node10');
    });

    it('falls back to the declared range when the installed package.json is unreadable', () => {
      const tree = installTypescript('{ not json');
      tree.write('package.json', JSON.stringify({ devDependencies: { typescript: '~6.0.3' } }));
      expect(getModuleResolution(tree)).toBe('bundler');
    });

    it('falls back to the declared range when the installed package.json has no version', () => {
      const tree = installTypescript(JSON.stringify({ name: 'typescript' }));
      tree.write('package.json', JSON.stringify({ dependencies: { typescript: '^6.0.0' } }));
      expect(getModuleResolution(tree)).toBe('bundler');
    });
  });
});

describe('getProjectTsOptions', () => {
  function workspace(typescript: string, baseCompilerOptions?: Record<string, unknown> | string) {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('package.json', JSON.stringify({ devDependencies: { typescript } }));
    if (typeof baseCompilerOptions === 'string') tree.write('tsconfig.base.json', baseCompilerOptions);
    else if (baseCompilerOptions) {
      tree.write('tsconfig.base.json', JSON.stringify({ compilerOptions: baseCompilerOptions }));
    }
    return tree;
  }

  it('resets customConditions inherited from a TS-solution base when resolving with node10 (TS5098)', () => {
    expect(getProjectTsOptions(workspace('~5.9.2', { customConditions: ['@org/source'] }))).toEqual({
      moduleResolution: 'node10',
      resetCustomConditions: true,
    });
  });

  it('keeps customConditions with bundler, which supports them', () => {
    expect(getProjectTsOptions(workspace('~6.0.3', { customConditions: ['@org/source'] }))).toEqual({
      moduleResolution: 'bundler',
      resetCustomConditions: false,
    });
  });

  it('has nothing to reset when the base does not declare customConditions', () => {
    expect(getProjectTsOptions(workspace('~5.9.2', { strict: true })).resetCustomConditions).toBe(false);
    expect(getProjectTsOptions(workspace('~5.9.2', {})).resetCustomConditions).toBe(false);
    expect(getProjectTsOptions(workspace('~5.9.2')).resetCustomConditions).toBe(false);
  });

  it('reads the base config of a workspace below the tree root', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('ws/package.json', JSON.stringify({ devDependencies: { typescript: '~5.9.2' } }));
    tree.write('ws/tsconfig.base.json', JSON.stringify({ compilerOptions: { customConditions: ['x'] } }));
    expect(getProjectTsOptions(tree, 'ws').resetCustomConditions).toBe(true);
  });

  it('treats an unreadable base config as declaring nothing', () => {
    expect(getProjectTsOptions(workspace('~5.9.2', '{ not json')).resetCustomConditions).toBe(false);
    expect(getProjectTsOptions(workspace('~5.9.2', '{}')).resetCustomConditions).toBe(false);
  });
});

describe('addTsPathAlias', () => {
  let tree: ReturnType<typeof createTreeWithEmptyWorkspace>;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('writes a ./-relative target, which TypeScript accepts without a baseUrl (TS5090)', () => {
    tree.write('tsconfig.base.json', JSON.stringify({ compilerOptions: {} }));
    addTsPathAlias(tree, '@acme/shared', 'libs/shared/src/index.ts');
    expect(readJson(tree, 'tsconfig.base.json').compilerOptions.paths).toEqual({
      '@acme/shared': ['./libs/shared/src/index.ts'],
    });
  });

  it('keeps targets that are already relative', () => {
    tree.write('tsconfig.base.json', JSON.stringify({}));
    addTsPathAlias(tree, '@acme/a', './libs/a/src/index.ts');
    addTsPathAlias(tree, '@acme/b', '../shared/b/src/index.ts');
    expect(readJson(tree, 'tsconfig.base.json').compilerOptions.paths).toEqual({
      '@acme/a': ['./libs/a/src/index.ts'],
      '@acme/b': ['../shared/b/src/index.ts'],
    });
  });

  it('replaces an alias unless asked to keep it', () => {
    tree.write('tsconfig.base.json', JSON.stringify({ compilerOptions: { paths: { '@acme/a': ['custom.ts'] } } }));
    addTsPathAlias(tree, '@acme/a', 'libs/a/src/index.ts', { overwrite: false });
    expect(readJson(tree, 'tsconfig.base.json').compilerOptions.paths['@acme/a']).toEqual(['custom.ts']);
    addTsPathAlias(tree, '@acme/a', 'libs/a/src/index.ts');
    expect(readJson(tree, 'tsconfig.base.json').compilerOptions.paths['@acme/a']).toEqual(['./libs/a/src/index.ts']);
  });

  it('does nothing when the workspace has no tsconfig.base.json', () => {
    tree.delete('tsconfig.base.json');
    addTsPathAlias(tree, '@acme/a', 'libs/a/src/index.ts');
    expect(tree.exists('tsconfig.base.json')).toBe(false);
  });
});
