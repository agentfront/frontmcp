import { updateJson } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';

import { detectWorkspacePackageManager, getPackageManagerCommands } from './package-manager';

describe('detectWorkspacePackageManager', () => {
  it('defaults to npm', () => {
    expect(detectWorkspacePackageManager(createTreeWithEmptyWorkspace())).toBe('npm');
  });

  it.each([
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
  ])('reads %s', (lockfile, expected) => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write(lockfile, '');
    expect(detectWorkspacePackageManager(tree)).toBe(expected);
  });

  it('prefers the package manager nx.json names', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('yarn.lock', '');
    updateJson(tree, 'nx.json', (json) => ({ ...json, cli: { packageManager: 'pnpm' } }));
    expect(detectWorkspacePackageManager(tree)).toBe('pnpm');
  });

  it('ignores an unknown package manager in nx.json', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('yarn.lock', '');
    updateJson(tree, 'nx.json', (json) => ({ ...json, cli: { packageManager: 'deno' } }));
    expect(detectWorkspacePackageManager(tree)).toBe('yarn');
  });

  it('works without an nx.json', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.delete('nx.json');
    tree.write('pnpm-lock.yaml', '');
    expect(detectWorkspacePackageManager(tree)).toBe('pnpm');
  });
});

describe('getPackageManagerCommands', () => {
  it.each([
    ['npm', { install: 'npm install', exec: 'npx' }],
    ['yarn', { install: 'yarn install', exec: 'yarn' }],
    ['pnpm', { install: 'pnpm install', exec: 'pnpm exec' }],
    ['bun', { install: 'bun install', exec: 'bunx' }],
  ])('gives the %s commands', (packageManager, expected) => {
    const tree = createTreeWithEmptyWorkspace();
    updateJson(tree, 'nx.json', (json) => ({ ...json, cli: { packageManager } }));
    expect(getPackageManagerCommands(tree)).toEqual(expected);
  });
});
