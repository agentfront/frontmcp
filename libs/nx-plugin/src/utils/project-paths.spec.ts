import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';

import { getIgnoreDeprecations, resolveProjectPaths } from './project-paths';

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

describe('getIgnoreDeprecations', () => {
  function withTypescript(range?: string, key: 'devDependencies' | 'dependencies' = 'devDependencies', root = '') {
    const tree = createTreeWithEmptyWorkspace();
    const path = root ? `${root}/package.json` : 'package.json';
    tree.write(path, JSON.stringify(range ? { [key]: { typescript: range } } : {}));
    return tree;
  }

  it('is empty for TypeScript 5', () => {
    expect(getIgnoreDeprecations(withTypescript('~5.9.2'))).toBe('');
  });

  it('acknowledges the node10 deprecation for TypeScript 6', () => {
    expect(getIgnoreDeprecations(withTypescript('~6.0.3'))).toBe('6.0');
    expect(getIgnoreDeprecations(withTypescript('^6.1.0', 'dependencies'))).toBe('6.0');
  });

  it('reads the workspace package.json below the tree root', () => {
    expect(getIgnoreDeprecations(withTypescript('~6.0.3', 'devDependencies', 'my-project'), 'my-project')).toBe('6.0');
  });

  it('is empty when TypeScript is not declared', () => {
    expect(getIgnoreDeprecations(withTypescript())).toBe('');
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
      expect(getIgnoreDeprecations(tree)).toBe('6.0');
    });

    it('reports nothing for an installed TypeScript 5', () => {
      expect(getIgnoreDeprecations(installTypescript(JSON.stringify({ version: '5.9.3' })))).toBe('');
    });

    it('falls back to the declared range when the installed package.json is unreadable', () => {
      const tree = installTypescript('{ not json');
      tree.write('package.json', JSON.stringify({ devDependencies: { typescript: '~6.0.3' } }));
      expect(getIgnoreDeprecations(tree)).toBe('6.0');
    });

    it('falls back to the declared range when the installed package.json has no version', () => {
      const tree = installTypescript(JSON.stringify({ name: 'typescript' }));
      tree.write('package.json', JSON.stringify({ dependencies: { typescript: '^6.0.0' } }));
      expect(getIgnoreDeprecations(tree)).toBe('6.0');
    });
  });
});
