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
});
