import { logger, readJson, updateJson } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';

import { detectWorkspacePackageManager, ensureYarnBerryPinned, getPackageManagerCommands } from './package-manager';

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
    expect(getPackageManagerCommands(tree)).toMatchObject(expected);
  });

  // #726 — the generated Dockerfile ran `npm ci`, which fails without a package-lock.json
  it.each([
    ['npm', { installFrozen: 'npm ci --ignore-scripts', pruneProduction: 'npm prune --omit=dev' }],
    [
      'pnpm',
      {
        setup: 'corepack enable',
        installFrozen: 'pnpm install --frozen-lockfile --ignore-scripts',
        pruneProduction: 'pnpm prune --prod --ignore-scripts',
      },
    ],
    [
      'bun',
      {
        setup: 'npm install -g bun',
        installFrozen: 'bun install --frozen-lockfile --ignore-scripts',
        pruneProduction: 'bun install --frozen-lockfile --production --ignore-scripts',
      },
    ],
  ])('gives the %s Docker commands', (packageManager, expected) => {
    const tree = createTreeWithEmptyWorkspace();
    updateJson(tree, 'nx.json', (json) => ({ ...json, cli: { packageManager } }));
    expect(getPackageManagerCommands(tree).docker).toEqual(expected);
  });

  it('tells Yarn Berry from Yarn 1 by .yarnrc.yml', () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('yarn.lock', '');
    expect(getPackageManagerCommands(tree).docker.installFrozen).toBe(
      'yarn install --frozen-lockfile --ignore-scripts',
    );

    tree.write('.yarnrc.yml', 'nodeLinker: node-modules\n');
    expect(getPackageManagerCommands(tree).docker).toEqual({
      setup: 'corepack enable',
      env: 'YARN_NODE_LINKER=node-modules',
      installFrozen: 'yarn install --immutable --mode=skip-build',
      pruneProduction: 'yarn workspaces focus --all --production',
    });
  });

  it("installs a Yarn Plug'n'Play workspace into node_modules for the image", () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('yarn.lock', '');
    tree.write('.yarnrc.yml', 'yarnPath: .yarn/releases/yarn-4.14.1.cjs\n');
    expect(getPackageManagerCommands(tree).docker.env).toBe('YARN_NODE_LINKER=node-modules');
  });
});

describe('ensureYarnBerryPinned', () => {
  const berryLockfile = '__metadata:\n  version: 8\n  cacheKey: 10\n';

  function berryWorkspace() {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('yarn.lock', berryLockfile);
    return tree;
  }

  afterEach(() => jest.restoreAllMocks());

  it('reads a Berry lockfile as Yarn Berry even without .yarnrc.yml', () => {
    expect(getPackageManagerCommands(berryWorkspace()).docker.installFrozen).toBe(
      'yarn install --immutable --mode=skip-build',
    );
  });

  it('pins the Yarn Berry version the generator runs under', () => {
    const tree = berryWorkspace();
    ensureYarnBerryPinned(tree, 'yarn/4.14.1 npm/? node/v24.1.0 darwin arm64');
    expect(readJson(tree, 'package.json').packageManager).toBe('yarn@4.14.1');
  });

  it('keeps a packageManager the workspace already pins', () => {
    const tree = berryWorkspace();
    updateJson(tree, 'package.json', (json) => ({ ...json, packageManager: 'yarn@4.5.0' }));
    ensureYarnBerryPinned(tree, 'yarn/4.14.1 npm/? node/v24.1.0 darwin arm64');
    expect(readJson(tree, 'package.json').packageManager).toBe('yarn@4.5.0');
  });

  it('leaves a workspace whose .yarnrc.yml sets yarnPath alone', () => {
    const tree = berryWorkspace();
    tree.write('.yarnrc.yml', 'yarnPath: .yarn/releases/yarn-4.14.1.cjs\n');
    ensureYarnBerryPinned(tree, 'yarn/4.14.1 npm/? node/v24.1.0 darwin arm64');
    expect(readJson(tree, 'package.json').packageManager).toBeUndefined();
  });

  it('warns when it cannot tell the Yarn Berry version', () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const tree = berryWorkspace();
    ensureYarnBerryPinned(tree, 'npm/10.9.0 node/v24.1.0 darwin arm64');
    expect(readJson(tree, 'package.json').packageManager).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('yarn set version'));
  });

  it('does nothing for Yarn 1 or other package managers', () => {
    const classic = createTreeWithEmptyWorkspace();
    classic.write('yarn.lock', '');
    ensureYarnBerryPinned(classic, 'yarn/1.22.22 npm/? node/v24.1.0 darwin arm64');
    expect(readJson(classic, 'package.json').packageManager).toBeUndefined();

    const npm = createTreeWithEmptyWorkspace();
    ensureYarnBerryPinned(npm, 'yarn/4.14.1 npm/? node/v24.1.0 darwin arm64');
    expect(readJson(npm, 'package.json').packageManager).toBeUndefined();
  });
});
