import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { runCmd } from '@frontmcp/utils';

import { type ParsedArgs } from '../../../core/args';
import { type ExecManifest } from '../../build/exec/manifest';
import { runInstall } from '../install';
import { runQuestionnaire, writeEnvFile } from '../questionnaire';
import { registerApp } from '../registry';
import { fetchFromGit } from '../sources/git';
import { fetchFromNpm } from '../sources/npm';

jest.mock('../../pm/paths', () => ({
  appDir: (name: string) => path.join(appsDir, name),
  ensurePmDirs: () => fs.mkdirSync(appsDir, { recursive: true }),
}));

jest.mock('../registry', () => ({
  registerApp: jest.fn(),
}));

jest.mock('@frontmcp/utils', () => ({
  // Keep the real filesystem helpers — these tests drive a real temp directory — and stub only
  // the child-process runner.
  ...jest.requireActual('@frontmcp/utils'),
  runCmd: jest.fn(),
}));

jest.mock('../questionnaire', () => ({
  runQuestionnaire: jest.fn(async () => ({ envContent: 'TOKEN=abc\n' })),
  writeEnvFile: jest.fn(),
}));

jest.mock('../sources/npm', () => ({ fetchFromNpm: jest.fn(async () => packageDir) }));
jest.mock('../sources/git', () => ({ fetchFromGit: jest.fn(async () => packageDir) }));
jest.mock('../sources/local', () => ({ fetchFromLocal: jest.fn(async (ref: string) => ref) }));

let homeDir: string;
let appsDir: string;
let packageDir: string;

function writePackage(
  manifest: Partial<ExecManifest>,
  files: Record<string, string> = {},
  dir: string = packageDir,
): void {
  const full: Record<string, unknown> = {
    version: '1.0.0',
    nodeVersion: '>=22',
    storage: { type: 'none', required: false },
    dependencies: { system: [], nativeAddons: [] },
    ...manifest,
  };

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'app.manifest.json'), JSON.stringify(full), 'utf-8');

  for (const [name, content] of Object.entries(files)) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf-8');
  }
}

function install(overrides: Partial<ParsedArgs> = {}, source: string = packageDir): Promise<void> {
  return runInstall({ _: ['install', source], ...overrides } as unknown as ParsedArgs);
}

beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-install-spec-'));
  appsDir = path.join(homeDir, '.frontmcp', 'apps');
  packageDir = path.join(homeDir, 'package');
  fs.mkdirSync(packageDir, { recursive: true });
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.clearAllMocks();
  // Drop any per-test implementation (the build-from-config case installs one); the other
  // mocks keep the implementations their module factories provide.
  (runCmd as jest.Mock).mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(homeDir, { recursive: true, force: true });
});

describe('runInstall', () => {
  it('installs a well-formed package into the apps directory', async () => {
    writePackage({ name: 'demo-app', bundle: 'bundle.js' }, { 'bundle.js': 'console.log(1);' });

    await install();

    const installDir = path.join(appsDir, 'demo-app');
    expect(fs.existsSync(path.join(installDir, 'bundle.js'))).toBe(true);
    expect(registerApp).toHaveBeenCalledWith('demo-app', expect.objectContaining({ installDir }));
  });

  it('rejects a manifest name that is not a plain directory name', async () => {
    const victim = path.join(homeDir, '.bashrc');
    fs.writeFileSync(victim, 'original', 'utf-8');
    writePackage({ name: '../../..', bundle: '.bashrc' }, { '.bashrc': 'attacker' });

    await expect(install()).rejects.toThrow(/Invalid plugin name/);

    expect(fs.readFileSync(victim, 'utf-8')).toBe('original');
    expect(registerApp).not.toHaveBeenCalled();
  });

  it.each(['..', '.', 'apps/../../x', 'a'.repeat(65), ''])('rejects the manifest name %p', async (name: string) => {
    writePackage({ name, bundle: 'bundle.js' }, { 'bundle.js': 'console.log(1);' });

    await expect(install()).rejects.toThrow(/Invalid plugin name/);
    expect(registerApp).not.toHaveBeenCalled();
  });

  it('rejects a bundle that resolves outside the app directory', async () => {
    writePackage({ name: 'demo-app', bundle: '../../../../.bashrc' });

    await expect(install()).rejects.toThrow(/Invalid manifest bundle/);
    expect(registerApp).not.toHaveBeenCalled();
  });

  it('rejects an absolute bundle path', async () => {
    writePackage({ name: 'demo-app', bundle: '/etc/passwd' });

    await expect(install()).rejects.toThrow(/Invalid manifest bundle/);
    expect(registerApp).not.toHaveBeenCalled();
  });

  it('rejects a manifest without a bundle', async () => {
    writePackage({ name: 'demo-app' });

    await expect(install()).rejects.toThrow(/Invalid manifest bundle/);
    expect(registerApp).not.toHaveBeenCalled();
  });

  describe('sources', () => {
    it('requires an install source', async () => {
      await expect(runInstall({ _: ['install'] } as unknown as ParsedArgs)).rejects.toThrow(/Missing install source/);
    });

    it('fetches npm packages through the npm source', async () => {
      writePackage({ name: 'demo-app', bundle: 'bundle.js' }, { 'bundle.js': '1;' });

      await install({ registry: 'https://registry.example.com' } as Partial<ParsedArgs>, 'demo-app');

      expect(fetchFromNpm).toHaveBeenCalledWith('demo-app', expect.any(String), 'https://registry.example.com');
    });

    it('fetches git packages through the git source', async () => {
      writePackage({ name: 'demo-app', bundle: 'bundle.js' }, { 'bundle.js': '1;' });

      await install({}, 'github:acme/demo-app');

      expect(fetchFromGit).toHaveBeenCalledWith('github:acme/demo-app', expect.any(String));
    });

    it('refuses esm sources', async () => {
      await expect(install({}, 'esm:@acme/demo')).rejects.toThrow(/ESM sources cannot be installed/);
    });
  });

  describe('manifest discovery', () => {
    it('finds a manifest nested in dist/', async () => {
      writePackage({ name: 'demo-app', bundle: 'bundle.js' }, { 'bundle.js': '1;' }, path.join(packageDir, 'dist'));

      await install();

      expect(fs.existsSync(path.join(appsDir, 'demo-app', 'bundle.js'))).toBe(true);
    });

    it('finds a manifest in a per-target dist subdirectory (dist/node)', async () => {
      writePackage(
        { name: 'demo-app', bundle: 'demo-app.bundle.js' },
        { 'demo-app.bundle.js': '1;' },
        path.join(packageDir, 'dist', 'node'),
      );

      await install();

      expect(fs.existsSync(path.join(appsDir, 'demo-app', 'demo-app.bundle.js'))).toBe(true);
      expect(registerApp).toHaveBeenCalledWith('demo-app', expect.anything());
    });

    // #679 — `frontmcp start` runs the bundle as a server: the node target's
    // manifest (with its port) must win over dist/cli, which sorts first.
    it('prefers dist/node over the other per-target directories', async () => {
      writePackage(
        { name: 'demo-app', bundle: 'cli.bundle.js' },
        { 'cli.bundle.js': '1;' },
        path.join(packageDir, 'dist', 'cli'),
      );
      writePackage(
        { name: 'demo-app', bundle: 'node.bundle.js', network: { defaultPort: 3456, supportsSocket: true } },
        { 'node.bundle.js': '1;' },
        path.join(packageDir, 'dist', 'node'),
      );

      await install();

      expect(fs.existsSync(path.join(appsDir, 'demo-app', 'node.bundle.js'))).toBe(true);
      expect(fs.existsSync(path.join(appsDir, 'demo-app', 'cli.bundle.js'))).toBe(false);
      expect(registerApp).toHaveBeenCalledWith('demo-app', expect.objectContaining({ port: 3456 }));
    });

    it.each(['frontmcp.config.ts', 'frontmcp.config.mjs', 'frontmcp.config.cjs', 'frontmcp.config.json'])(
      'builds from %s when no manifest is present',
      async (configName) => {
        fs.writeFileSync(path.join(packageDir, configName), '{}', 'utf-8');
        (runCmd as jest.Mock).mockImplementation(async () => {
          writePackage(
            { name: 'built-app', bundle: 'bundle.js' },
            { 'bundle.js': '1;' },
            path.join(packageDir, 'dist', 'node'),
          );
        });

        await install();

        expect(runCmd).toHaveBeenCalledWith('npx', ['frontmcp', 'build', '--target', 'node'], { cwd: packageDir });
        expect(registerApp).toHaveBeenCalledWith('built-app', expect.anything());
      },
    );

    it('installs project dependencies before building a fetched source', async () => {
      fs.writeFileSync(path.join(packageDir, 'frontmcp.config.js'), 'module.exports = {};', 'utf-8');
      fs.writeFileSync(path.join(packageDir, 'package.json'), '{}', 'utf-8');
      const order: string[] = [];
      (runCmd as jest.Mock).mockImplementation(async (cmd: string, args: string[]) => {
        order.push(`${cmd} ${args[0]}`);
        if (cmd === 'npx') {
          writePackage(
            { name: 'built-app', bundle: 'bundle.js' },
            { 'bundle.js': '1;' },
            path.join(packageDir, 'dist', 'node'),
          );
        }
      });

      await install();

      expect(order.slice(0, 2)).toEqual(['npm install', 'npx frontmcp']);
    });

    it('builds from frontmcp.config.js when no manifest is present', async () => {
      fs.writeFileSync(path.join(packageDir, 'frontmcp.config.js'), 'module.exports = {};', 'utf-8');
      (runCmd as jest.Mock).mockImplementation(async () => {
        writePackage({ name: 'built-app', bundle: 'bundle.js' }, { 'bundle.js': '1;' }, path.join(packageDir, 'dist'));
      });

      await install();

      expect(runCmd).toHaveBeenCalledWith('npx', ['frontmcp', 'build', '--target', 'node'], {
        cwd: packageDir,
      });
      expect(registerApp).toHaveBeenCalledWith('built-app', expect.anything());
    });

    it('fails when there is no manifest and nothing to build', async () => {
      await expect(install()).rejects.toThrow(/Could not find or generate a manifest/);
    });
  });

  describe('copied files', () => {
    it('does not follow a symlink that points outside the package', async () => {
      const hostSecret = path.join(homeDir, 'host-secret.txt');
      fs.writeFileSync(hostSecret, 'HOST-ONLY', 'utf-8');
      writePackage({ name: 'demo-app', bundle: 'bundle.js' });
      fs.symlinkSync(hostSecret, path.join(packageDir, 'bundle.js'));

      await install();

      const copied = path.join(appsDir, 'demo-app', 'bundle.js');
      expect(fs.existsSync(copied)).toBe(false);
      expect(registerApp).toHaveBeenCalled();
    });

    it('does not follow a symlinked directory on the way to the bundle', async () => {
      const hostDir = path.join(homeDir, 'outside');
      fs.mkdirSync(hostDir, { recursive: true });
      fs.writeFileSync(path.join(hostDir, 'bundle.js'), 'HOST-ONLY', 'utf-8');
      writePackage({ name: 'demo-app', bundle: 'nested/bundle.js' });
      fs.symlinkSync(hostDir, path.join(packageDir, 'nested'));

      await install();

      expect(fs.existsSync(path.join(appsDir, 'demo-app', 'nested', 'bundle.js'))).toBe(false);
    });

    it('follows a symlink that stays inside the package', async () => {
      writePackage({ name: 'demo-app', bundle: 'bundle.js' }, { 'real-bundle.js': 'inside();' });
      fs.symlinkSync(path.join(packageDir, 'real-bundle.js'), path.join(packageDir, 'bundle.js'));

      await install();

      expect(fs.readFileSync(path.join(appsDir, 'demo-app', 'bundle.js'), 'utf-8')).toBe('inside();');
    });

    it('creates intermediate directories for a nested bundle path', async () => {
      writePackage({ name: 'demo-app', bundle: 'nested/bundle.js' }, { 'nested/bundle.js': 'nested();' });

      await install();

      expect(fs.readFileSync(path.join(appsDir, 'demo-app', 'nested', 'bundle.js'), 'utf-8')).toBe('nested();');
    });

    it('skips a bundle that is not a regular file', async () => {
      writePackage({ name: 'demo-app', bundle: 'bundle.js' });
      fs.mkdirSync(path.join(packageDir, 'bundle.js'), { recursive: true });

      await install();

      expect(fs.existsSync(path.join(appsDir, 'demo-app', 'bundle.js'))).toBe(false);
    });
  });

  describe('post-copy steps', () => {
    it('marks the runner executable', async () => {
      writePackage({ name: 'demo-app', bundle: 'bundle.js' }, { 'bundle.js': '1;', 'demo-app': '#!/bin/sh\n' });

      await install();

      const mode = fs.statSync(path.join(appsDir, 'demo-app', 'demo-app')).mode;
      expect(mode & 0o111).toBe(0o111);
    });

    it('installs declared native addons', async () => {
      writePackage(
        {
          name: 'demo-app',
          bundle: 'bundle.js',
          dependencies: { system: [], nativeAddons: ['better-sqlite3'] },
        },
        { 'bundle.js': '1;' },
      );

      await install();

      const installDir = path.join(appsDir, 'demo-app');
      expect(runCmd).toHaveBeenCalledWith('npm', ['init', '-y', '--silent'], { cwd: installDir });
      expect(runCmd).toHaveBeenCalledWith('npm', expect.arrayContaining(['better-sqlite3', '--save', '--silent']), {
        cwd: installDir,
      });
    });

    it('installs the externalized runtime packages next to the bundle', async () => {
      writePackage({ name: 'demo-app', bundle: 'bundle.js' }, { 'bundle.js': '1;' });

      await install();

      const installDir = path.join(appsDir, 'demo-app');
      const installCall = (runCmd as jest.Mock).mock.calls.find(
        ([cmd, args]) => cmd === 'npm' && args[0] === 'install',
      );
      expect(installCall).toBeDefined();
      const specs: string[] = installCall[1];
      expect(specs).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^@frontmcp\/sdk@/),
          'reflect-metadata@^0.2.2',
          // #679 — loaded by the SDK's skill registry at start-up (and its undeclared tslib)
          expect.stringMatching(/^vectoriadb@/),
          expect.stringMatching(/^tslib@/),
        ]),
      );
      expect(installCall[2]).toEqual({ cwd: installDir });
    });

    it('uses the versions the project declares for runtime packages', async () => {
      writePackage({ name: 'demo-app', bundle: 'bundle.js' }, { 'bundle.js': '1;' });
      fs.writeFileSync(
        path.join(packageDir, 'package.json'),
        JSON.stringify({ dependencies: { '@frontmcp/sdk': '1.8.3', 'reflect-metadata': '^0.2.1' } }),
        'utf-8',
      );

      await install();

      const installCall = (runCmd as jest.Mock).mock.calls.find(
        ([cmd, args]) => cmd === 'npm' && args[0] === 'install',
      );
      expect(installCall[1]).toEqual(expect.arrayContaining(['@frontmcp/sdk@1.8.3', 'reflect-metadata@^0.2.1']));
    });

    it('does not re-init an install dir that already has a package.json', async () => {
      writePackage({ name: 'demo-app', bundle: 'bundle.js' }, { 'bundle.js': '1;' });
      const installDir = path.join(appsDir, 'demo-app');
      fs.mkdirSync(installDir, { recursive: true });
      fs.writeFileSync(path.join(installDir, 'package.json'), '{}', 'utf-8');

      await install();

      expect(runCmd).not.toHaveBeenCalledWith('npm', ['init', '-y', '--silent'], expect.anything());
    });

    it('creates the sqlite data directory', async () => {
      writePackage(
        { name: 'demo-app', bundle: 'bundle.js', storage: { type: 'sqlite', required: true } },
        { 'bundle.js': '1;' },
      );
      jest.spyOn(os, 'homedir').mockReturnValue(homeDir);

      await install();

      expect(fs.existsSync(path.join(homeDir, '.frontmcp', 'data', 'demo-app'))).toBe(true);
    });

    it('runs the setup questionnaire and writes the env file', async () => {
      writePackage(
        {
          name: 'demo-app',
          bundle: 'bundle.js',
          setup: {
            steps: [{ id: 'token', prompt: 'Token?', jsonSchema: { type: 'string' }, env: 'TOKEN' }],
          },
        },
        { 'bundle.js': '1;' },
      );

      await install({ yes: true } as Partial<ParsedArgs>);

      expect(runQuestionnaire).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: 'token' })]),
        {
          silent: true,
        },
      );
      expect(writeEnvFile).toHaveBeenCalledWith(path.join(appsDir, 'demo-app'), 'TOKEN=abc\n');
    });
  });

  describe('registry entry', () => {
    it('records the manifest default port', async () => {
      writePackage(
        { name: 'demo-app', bundle: 'bundle.js', network: { defaultPort: 4100, supportsSocket: true } },
        { 'bundle.js': '1;' },
      );

      await install();

      expect(registerApp).toHaveBeenCalledWith('demo-app', expect.objectContaining({ port: 4100 }));
    });

    it('prefers an explicit --port over the manifest, including port 0', async () => {
      writePackage(
        { name: 'demo-app', bundle: 'bundle.js', network: { defaultPort: 4100, supportsSocket: true } },
        { 'bundle.js': '1;' },
      );

      await install({ port: 0 } as Partial<ParsedArgs>);

      expect(registerApp).toHaveBeenCalledWith('demo-app', expect.objectContaining({ port: 0 }));
    });

    it('leaves the port unset for manifests without a network section', async () => {
      writePackage({ name: 'demo-app', bundle: 'bundle.js' }, { 'bundle.js': '1;' });

      await install();

      expect(registerApp).toHaveBeenCalledWith(
        'demo-app',
        expect.objectContaining({ port: undefined, runner: path.join(appsDir, 'demo-app', 'demo-app') }),
      );
    });
  });
});
