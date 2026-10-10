/**
 * Shell-less, cross-platform tool commands (#731).
 *
 * On Windows `npm`/`npx`/`yarn`/`pnpm` are `.cmd` shims: a shell-less spawn of
 * `npx.cmd` throws EINVAL (Node's CVE-2024-27980 fix), of `npx` fails with
 * ENOENT, and `shell: true` emits DEP0190. These specs pin what each command
 * resolves to, with the platform and file system injected.
 */
import * as path from 'path';

import { runCmd } from '@frontmcp/utils';

import {
  findOnWindowsPath,
  packageManagerCommand,
  projectToolCommand,
  quoteWindowsArgument,
  resolveNpmCliScript,
  resolvePackageBin,
  runTool,
  spawnTool,
  windowsShellCommand,
  type ToolHost,
} from '../tool-command';

const spawnMock = jest.fn();
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

jest.mock('@frontmcp/utils', () => ({
  ...jest.requireActual('@frontmcp/utils'),
  runCmd: jest.fn(async () => undefined),
}));

const runCmdMock = runCmd as unknown as jest.Mock;

const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const BUNDLED_NPM = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin';

/** A Windows host whose file system holds exactly `files`. */
function windows(files: string[] = [], env: NodeJS.ProcessEnv = {}): Partial<ToolHost> {
  const existing = new Set(files.map((f) => f.toLowerCase()));
  return { platform: 'win32', execPath: NODE, env, isFile: (file) => existing.has(file.toLowerCase()) };
}

beforeEach(() => {
  spawnMock.mockReset();
  runCmdMock.mockReset().mockResolvedValue(undefined);
});

describe('packageManagerCommand', () => {
  it.each(['npm', 'npx', 'yarn', 'pnpm', 'bun'] as const)('runs %s by name on POSIX', (name) => {
    expect(packageManagerCommand(name, ['-v'], { platform: 'linux' })).toEqual({
      label: name,
      command: name,
      args: ['-v'],
    });
  });

  describe('npm and npx on Windows', () => {
    it('run the npm that ships next to node.exe, with node', () => {
      const host = windows([`${BUNDLED_NPM}\\npm-cli.js`, `${BUNDLED_NPM}\\npx-cli.js`]);
      expect(packageManagerCommand('npm', ['-v'], host)).toEqual({
        label: 'npm',
        command: NODE,
        args: [`${BUNDLED_NPM}\\npm-cli.js`, '-v'],
      });
      expect(packageManagerCommand('npx', ['-y', 'tsx'], host).args).toEqual([
        `${BUNDLED_NPM}\\npx-cli.js`,
        '-y',
        'tsx',
      ]);
    });

    it('prefer the npm that started us (npm_execpath)', () => {
      const own = 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\npm\\bin';
      const host = windows([`${own}\\npx-cli.js`, `${BUNDLED_NPM}\\npx-cli.js`], {
        npm_execpath: `${own}\\npm-cli.js`,
      });
      expect(packageManagerCommand('npx', ['tsc'], host).args[0]).toBe(`${own}\\npx-cli.js`);
    });

    it('ignore an npm_execpath that belongs to another package manager', () => {
      const host = windows([`${BUNDLED_NPM}\\npm-cli.js`], { npm_execpath: 'C:\\proj\\.yarn\\releases\\yarn-4.cjs' });
      expect(packageManagerCommand('npm', [], host).args[0]).toBe(`${BUNDLED_NPM}\\npm-cli.js`);
    });

    it('fall back to the npm.cmd shim on PATH through cmd.exe', () => {
      const host = windows(['C:\\tools\\npm.cmd'], { Path: 'C:\\tools', ComSpec: 'C:\\Windows\\system32\\cmd.exe' });
      expect(packageManagerCommand('npm', ['install'], host)).toEqual({
        label: 'npm',
        command: 'C:\\Windows\\system32\\cmd.exe',
        args: ['/d', '/s', '/c', '"C:\\tools\\npm.cmd ^^^"install^^^""'],
        windowsVerbatimArguments: true,
      });
    });
  });

  describe('yarn, pnpm and bun on Windows', () => {
    it('run the manager that started us from npm_execpath', () => {
      const yarn = 'C:\\proj\\.yarn\\releases\\yarn-4.14.1.cjs';
      expect(packageManagerCommand('yarn', ['install'], windows([], { npm_execpath: yarn }))).toEqual({
        label: 'yarn',
        command: NODE,
        args: [yarn, 'install'],
      });
      const bun = 'C:\\Users\\me\\.bun\\bin\\bun.exe';
      expect(packageManagerCommand('bun', ['x', 'tsc'], windows([], { npm_execpath: bun }))).toEqual({
        label: 'bun',
        command: bun,
        args: ['x', 'tsc'],
      });
    });

    it('run an .exe found on PATH directly, and a .cmd shim through cmd.exe', () => {
      expect(packageManagerCommand('pnpm', ['install'], windows(['C:\\pnpm\\pnpm.exe'], { PATH: 'C:\\pnpm' }))).toEqual(
        { label: 'pnpm', command: 'C:\\pnpm\\pnpm.exe', args: ['install'] },
      );
      const viaShim = packageManagerCommand(
        'yarn',
        ['install'],
        windows(['C:\\corepack\\yarn.cmd'], { PATH: 'C:\\corepack', npm_execpath: `${BUNDLED_NPM}\\npm-cli.js` }),
      );
      expect(viaShim.command).toBe('cmd.exe');
      expect(viaShim.windowsVerbatimArguments).toBe(true);
    });

    it('leave an unknown name to cmd.exe, which reports it is not recognized', () => {
      expect(packageManagerCommand('pnpm', ['install'], windows())).toEqual({
        label: 'pnpm',
        command: 'cmd.exe',
        args: ['/d', '/s', '/c', '"pnpm ^^^"install^^^""'],
        windowsVerbatimArguments: true,
      });
    });

    it('ignore an npm_execpath it cannot run', () => {
      const host = windows([], { npm_execpath: 'C:\\yarn\\yarn' });
      expect(packageManagerCommand('yarn', [], host).command).toBe('cmd.exe');
    });

    it('ignore an npm_execpath of another tool whose name starts with the manager', () => {
      const host = windows([], { npm_execpath: 'C:\\Users\\me\\.bun\\bin\\bunx.exe' });
      expect(packageManagerCommand('bun', ['install'], host).command).toBe('cmd.exe');
    });
  });
});

describe('resolveNpmCliScript', () => {
  it('finds npm under a POSIX prefix (lib/node_modules)', () => {
    const files = new Set(['/usr/local/lib/node_modules/npm/bin/npx-cli.js']);
    const host: Partial<ToolHost> = {
      platform: 'linux',
      execPath: '/usr/local/bin/node',
      env: {},
      isFile: (f) => files.has(f),
    };
    expect(resolveNpmCliScript('npx', host)).toBe('/usr/local/lib/node_modules/npm/bin/npx-cli.js');
  });

  it('returns undefined when no npm is found', () => {
    expect(resolveNpmCliScript('npm', windows())).toBeUndefined();
  });
});

describe('findOnWindowsPath', () => {
  it('walks PATH in order with PATHEXT, matching names case-insensitively', () => {
    const host = windows(['C:\\b\\tool.CMD', 'C:\\a\\tool.exe'], { Path: '"C:\\a";C:\\b', PATHEXT: '.CMD;.EXE' });
    expect(findOnWindowsPath('tool', host)?.toLowerCase()).toBe('c:\\a\\tool.exe');
  });

  it('uses the default PATHEXT and returns undefined when nothing matches', () => {
    expect(findOnWindowsPath('tool', windows(['C:\\a\\tool.bat'], { PATH: 'C:\\a' }))).toBe('C:\\a\\tool.bat');
    expect(findOnWindowsPath('tool', windows([], { PATH: 'C:\\a' }))).toBeUndefined();
    expect(findOnWindowsPath('tool', windows())).toBeUndefined();
  });
});

describe('quoteWindowsArgument', () => {
  it.each([
    ['plain', '"plain"'],
    ['', '""'],
    ['with space', '"with space"'],
    ['say "hi"', '"say \\"hi\\""'],
    ['C:\\dir\\', '"C:\\dir\\\\"'],
    ['a\\"b', '"a\\\\\\"b"'],
    ['a\\b', '"a\\b"'],
  ])('quotes %j as %s', (arg, quoted) => {
    expect(quoteWindowsArgument(arg)).toBe(quoted);
  });
});

describe('windowsShellCommand', () => {
  it('escapes cmd.exe metacharacters twice for a batch shim', () => {
    expect(windowsShellCommand('npm', 'npm.cmd', ['a&b', '100%'], { env: {} }).args[3]).toBe(
      '"npm.cmd ^^^"a^^^&b^^^" ^^^"100^^^%^^^""',
    );
  });

  it('escapes them once for an executable and escapes the command path', () => {
    expect(windowsShellCommand('x', 'C:\\Program Files\\x.exe', ['a|b'], { env: { COMSPEC: 'C:\\cmd.exe' } })).toEqual({
      label: 'x',
      command: 'C:\\cmd.exe',
      args: ['/d', '/s', '/c', '"C:\\Program^ Files\\x.exe ^"a^|b^""'],
      windowsVerbatimArguments: true,
    });
  });
});

describe('resolvePackageBin', () => {
  const manifests: Record<string, unknown> = {
    '/proj/node_modules/tsx/package.json': { bin: './dist/cli.mjs' },
    '/proj/node_modules/typescript/package.json': { bin: { tsc: './bin/tsc', tsserver: './bin/tsserver' } },
    '/proj/node_modules/@scope/tool/package.json': { bin: 'cli.js' },
    '/proj/node_modules/broken/package.json': 'unreadable',
    '/proj/node_modules/nobin/package.json': {},
  };
  const files = new Set([
    ...Object.keys(manifests),
    '/proj/node_modules/tsx/dist/cli.mjs',
    '/proj/node_modules/typescript/bin/tsc',
    '/proj/node_modules/@scope/tool/cli.js',
  ]);
  const host: Partial<ToolHost> = {
    platform: 'linux',
    isFile: (f) => files.has(f),
    readJson: (f) => {
      if (manifests[f] === 'unreadable') throw new Error('bad json');
      return manifests[f];
    },
    resolveFrom: (request, dir) =>
      request === 'tsx/package.json' && dir === '/proj' ? '/proj/node_modules/tsx/package.json' : undefined,
  };

  it('reads a string bin named after the package', () => {
    expect(resolvePackageBin('tsx', 'tsx', ['/proj'], host)).toBe('/proj/node_modules/tsx/dist/cli.mjs');
    expect(resolvePackageBin('@scope/tool', 'tool', ['/proj/src'], host)).toBe('/proj/node_modules/@scope/tool/cli.js');
    expect(resolvePackageBin('tsx', 'other', ['/proj'], host)).toBeUndefined();
  });

  it('reads a bin map, walking node_modules when package.json is not resolvable', () => {
    expect(resolvePackageBin('typescript', 'tsc', ['/proj/a/b'], host)).toBe('/proj/node_modules/typescript/bin/tsc');
    expect(resolvePackageBin('typescript', 'tsserver', ['/proj'], host)).toBeUndefined();
  });

  it('skips unreadable manifests, missing bins and missing packages', () => {
    expect(resolvePackageBin('broken', 'broken', ['/proj'], host)).toBeUndefined();
    expect(resolvePackageBin('nobin', 'nobin', ['/proj'], host)).toBeUndefined();
    expect(resolvePackageBin('absent', 'absent', ['/proj', '/elsewhere'], host)).toBeUndefined();
  });

  it('resolves real packages with the default host', () => {
    const repoRoot = path.resolve(__dirname, '../../../../..');
    expect(resolvePackageBin('tsx', 'tsx', [repoRoot])).toMatch(/tsx[\\/]dist[\\/]cli\.mjs$/);
    expect(resolvePackageBin('typescript', 'tsc', [repoRoot])).toMatch(/typescript[\\/]bin[\\/]tsc$/);
    expect(resolvePackageBin('no-such-package-xyz', 'x', [repoRoot])).toBeUndefined();
  });
});

describe('projectToolCommand', () => {
  const host: Partial<ToolHost> = {
    platform: 'linux',
    execPath: '/usr/bin/node',
    isFile: (f) => f === '/proj/node_modules/typescript/bin/tsc' || f.endsWith('typescript/package.json'),
    readJson: () => ({ bin: { tsc: './bin/tsc' } }),
    resolveFrom: () => undefined,
  };
  const spec = { package: 'typescript', bin: 'tsc', npx: ['-y', '--package', 'typescript', 'tsc'] };

  it("runs the project's bin with node", () => {
    expect(projectToolCommand(spec, ['--noEmit'], { from: ['/proj'], host })).toEqual({
      label: 'tsc',
      command: '/usr/bin/node',
      args: ['/proj/node_modules/typescript/bin/tsc', '--noEmit'],
    });
  });

  it('falls back to npx when the project does not install it', () => {
    expect(
      projectToolCommand(spec, ['--noEmit'], { from: ['/other'], host: { ...host, isFile: () => false } }),
    ).toEqual({
      label: 'npx',
      command: 'npx',
      args: ['-y', '--package', 'typescript', 'tsc', '--noEmit'],
    });
  });

  it('defaults to the current directory', () => {
    expect(projectToolCommand({ package: 'tsx', npx: ['-y', 'tsx'] }, ['--version']).args[0]).toMatch(/cli\.mjs$/);
  });
});

describe('spawnTool', () => {
  it('never uses a shell and passes pre-quoted arguments verbatim', () => {
    spawnTool({ label: 'npm', command: 'cmd.exe', args: ['/c', '"x"'], windowsVerbatimArguments: true }, { cwd: '/p' });
    expect(spawnMock).toHaveBeenCalledWith('cmd.exe', ['/c', '"x"'], {
      cwd: '/p',
      shell: false,
      windowsVerbatimArguments: true,
    });
    spawnTool({ label: 'npm', command: 'npm', args: [] });
    expect(spawnMock).toHaveBeenLastCalledWith('npm', [], { shell: false });
  });
});

describe('runTool', () => {
  it('runs through runCmd with the verbatim flag only when set', async () => {
    await runTool({ label: 'npm', command: 'npm', args: ['ci'] }, { cwd: '/p' });
    expect(runCmdMock).toHaveBeenLastCalledWith('npm', ['ci'], { cwd: '/p' });
    await runTool({ label: 'yarn', command: 'cmd.exe', args: ['/c'], windowsVerbatimArguments: true });
    expect(runCmdMock).toHaveBeenLastCalledWith('cmd.exe', ['/c'], { windowsVerbatimArguments: true });
  });

  it('names the tool, not node.exe, when it fails', async () => {
    runCmdMock.mockRejectedValueOnce(new Error(`${NODE} exited with code 1`));
    await expect(runTool({ label: 'npm', command: NODE, args: [] })).rejects.toThrow('npm exited with code 1');
  });

  it('passes other failures through unchanged', async () => {
    runCmdMock.mockRejectedValueOnce(new Error('npm exited with code 2'));
    await expect(runTool({ label: 'npm', command: 'npm', args: [] })).rejects.toThrow('npm exited with code 2');
    runCmdMock.mockRejectedValueOnce('boom');
    await expect(runTool({ label: 'npm', command: NODE, args: [] })).rejects.toBe('boom');
  });
});
