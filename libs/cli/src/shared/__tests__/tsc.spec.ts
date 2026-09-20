// file: libs/cli/src/shared/__tests__/tsc.spec.ts

import { existsSync } from 'fs';
import * as path from 'path';

import { runCmd } from '@frontmcp/utils';

import { detectPackageManager, isYarnPnpProject, packageManagerTscCommand, resolveProjectTsc, runTsc } from '../tsc';

jest.mock('fs', () => ({ existsSync: jest.fn() }));
jest.mock('@frontmcp/utils', () => ({ runCmd: jest.fn(async () => undefined) }));

const existsSyncMock = existsSync as unknown as jest.Mock;
const runCmdMock = runCmd as unknown as jest.Mock;

/** A path that exists nowhere, so `typescript` cannot be resolved from it. */
const PROJECT = path.join(path.sep, 'projects', 'demo');

/** A real directory inside this workspace, so `typescript` resolves from it. */
const RESOLVABLE_PROJECT = __dirname;
const TSC_BIN = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');

/** Make `existsSync` answer true for exactly the given absolute paths. */
function onlyExists(...paths: string[]): void {
  const allowed = new Set(paths);
  existsSyncMock.mockImplementation((p: string) => allowed.has(p));
}

describe('detectPackageManager', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['bun.lockb', 'bun'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
  ])('maps %s to %s', (lockfile, expected) => {
    onlyExists(path.join(PROJECT, lockfile));
    expect(detectPackageManager(PROJECT)).toBe(expected);
  });

  it('falls back to npm when no lockfile is present', () => {
    onlyExists();
    expect(detectPackageManager(PROJECT)).toBe('npm');
  });

  it('prefers the fastest manager when several lockfiles coexist', () => {
    onlyExists(path.join(PROJECT, 'pnpm-lock.yaml'), path.join(PROJECT, 'yarn.lock'));
    expect(detectPackageManager(PROJECT)).toBe('pnpm');
  });
});

describe('isYarnPnpProject', () => {
  beforeEach(() => jest.clearAllMocks());

  it('detects a committed .pnp.cjs', () => {
    onlyExists(path.join(PROJECT, '.pnp.cjs'));
    expect(isYarnPnpProject(PROJECT)).toBe(true);
  });

  it('detects the legacy .pnp.js name', () => {
    onlyExists(path.join(PROJECT, '.pnp.js'));
    expect(isYarnPnpProject(PROJECT)).toBe(true);
  });

  it('is false for a node-modules project', () => {
    onlyExists(path.join(PROJECT, 'yarn.lock'));
    expect(isYarnPnpProject(PROJECT)).toBe(false);
  });
});

describe('packageManagerTscCommand', () => {
  it('routes yarn through its own runner so Plug n Play stays loaded', () => {
    expect(packageManagerTscCommand('yarn', ['--noEmit'])).toEqual({
      command: 'yarn',
      args: ['tsc', '--noEmit'],
    });
  });

  it('uses pnpm exec', () => {
    expect(packageManagerTscCommand('pnpm', ['--noEmit'])).toEqual({
      command: 'pnpm',
      args: ['exec', 'tsc', '--noEmit'],
    });
  });

  it('uses bun x', () => {
    expect(packageManagerTscCommand('bun', [])).toEqual({
      command: 'bun',
      args: ['x', '--package', 'typescript', 'tsc'],
    });
  });

  it('falls back to npx for npm', () => {
    expect(packageManagerTscCommand('npm', ['-p', 'tsconfig.json'])).toEqual({
      command: 'npx',
      args: ['-y', '--package', 'typescript', 'tsc', '-p', 'tsconfig.json'],
    });
  });

  it.each(['npm', 'bun'] as const)(
    'names the typescript package explicitly for %s, so a registry fetch cannot pull the deprecated `tsc` package',
    (manager) => {
      const { args } = packageManagerTscCommand(manager, []);
      expect(args).toContain('--package');
      expect(args[args.indexOf('--package') + 1]).toBe('typescript');
    },
  );
});

describe('resolveProjectTsc', () => {
  beforeEach(() => jest.clearAllMocks());

  it('resolves bin/tsc next to the resolved typescript manifest', () => {
    onlyExists(TSC_BIN);
    expect(resolveProjectTsc(RESOLVABLE_PROJECT)).toBe(TSC_BIN);
  });

  it('returns undefined when bin/tsc is missing from the install', () => {
    onlyExists();
    expect(resolveProjectTsc(RESOLVABLE_PROJECT)).toBeUndefined();
  });

  it('returns undefined when typescript is not installed for the project at all', () => {
    onlyExists();
    expect(resolveProjectTsc(PROJECT)).toBeUndefined();
  });
});

describe('runTsc (issue #534)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('runs the project typescript through the current node binary', async () => {
    onlyExists(TSC_BIN);

    await runTsc(['--project', 'tsconfig.json'], { cwd: RESOLVABLE_PROJECT });

    expect(runCmdMock).toHaveBeenCalledWith(process.execPath, [TSC_BIN, '--project', 'tsconfig.json'], {
      cwd: RESOLVABLE_PROJECT,
    });
  });

  it('never spawns npx for a Plug n Play project that has typescript installed', async () => {
    onlyExists(TSC_BIN, path.join(RESOLVABLE_PROJECT, '.pnp.cjs'));

    await runTsc([], { cwd: RESOLVABLE_PROJECT });

    expect(runCmdMock.mock.calls[0][0]).toBe(process.execPath);
  });

  it('delegates to yarn when typescript cannot be resolved from the project', async () => {
    onlyExists(path.join(PROJECT, 'yarn.lock'), path.join(PROJECT, '.pnp.cjs'));

    await runTsc(['--outDir', 'dist'], { cwd: PROJECT });

    expect(runCmdMock).toHaveBeenCalledWith('yarn', ['tsc', '--outDir', 'dist'], { cwd: PROJECT });
  });

  it('delegates to npx when nothing else is detectable', async () => {
    onlyExists();

    await runTsc(['--outDir', 'dist'], { cwd: PROJECT });

    expect(runCmdMock).toHaveBeenCalledWith('npx', ['-y', '--package', 'typescript', 'tsc', '--outDir', 'dist'], {
      cwd: PROJECT,
    });
  });
});
