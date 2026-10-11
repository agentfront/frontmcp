import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { buildMachinePlatform, copyNativeAddons, resolvePackageDir } from '../native-addons';

function writePackage(dir: string, manifest: Record<string, unknown>, files: Record<string, string> = {}): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
}

describe('native addons in an mcpb archive', () => {
  let root: string;
  let projectDir: string;
  let serverDir: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-native-addons-')));
    projectDir = path.join(root, 'workspace', 'project');
    serverDir = path.join(root, 'stage', 'server');
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function relativeDests(copied: Array<{ destDir: string }>): string[] {
    return copied.map((pkg) => path.relative(serverDir, pkg.destDir)).sort();
  }

  it('resolves a package the way Node does, walking up to a hoisted node_modules', async () => {
    writePackage(path.join(root, 'workspace', 'node_modules', 'hoisted'), { name: 'hoisted' });
    expect(await resolvePackageDir('hoisted', projectDir)).toBe(path.join(root, 'workspace', 'node_modules', 'hoisted'));
    expect(await resolvePackageDir('missing', projectDir)).toBeUndefined();
  });

  it('copies the addon with its binary and its dependency closure', async () => {
    writePackage(
      path.join(projectDir, 'node_modules', 'addon'),
      { name: 'addon', dependencies: { bindings: '1' }, optionalDependencies: { 'not-installed': '1' } },
      { 'build/Release/addon.node': 'binary' },
    );
    writePackage(path.join(projectDir, 'node_modules', 'bindings'), { name: 'bindings', dependencies: { 'file-uri': '1' } });
    writePackage(path.join(root, 'workspace', 'node_modules', 'file-uri'), { name: 'file-uri' });

    const copied = await copyNativeAddons({ addons: ['addon'], projectDir, serverDir });

    expect(relativeDests(copied)).toEqual(['node_modules/addon', 'node_modules/bindings', 'node_modules/file-uri']);
    expect(fs.readFileSync(path.join(serverDir, 'node_modules/addon/build/Release/addon.node'), 'utf8')).toBe('binary');
  });

  it('follows a symlinked package to its real location and copies files, not links', async () => {
    const store = path.join(root, 'store', 'addon@1', 'node_modules');
    writePackage(path.join(store, 'addon'), { name: 'addon', dependencies: { sibling: '1' } }, { 'index.js': '' });
    writePackage(path.join(store, 'sibling'), { name: 'sibling' });
    fs.mkdirSync(path.join(projectDir, 'node_modules'), { recursive: true });
    fs.symlinkSync(path.join(store, 'addon'), path.join(projectDir, 'node_modules', 'addon'));

    const copied = await copyNativeAddons({ addons: ['addon'], projectDir, serverDir });

    expect(relativeDests(copied)).toEqual(['node_modules/addon', 'node_modules/sibling']);
    expect(fs.lstatSync(path.join(serverDir, 'node_modules/addon')).isSymbolicLink()).toBe(false);
  });

  it('nests a second version of a package under the package that needs it', async () => {
    const store = path.join(root, 'store', 'helper@1', 'node_modules');
    writePackage(path.join(store, 'helper'), { name: 'helper', dependencies: { stream: '2' } });
    writePackage(path.join(store, 'stream'), { name: 'stream', version: '2.0.0' });
    writePackage(path.join(projectDir, 'node_modules', 'addon'), { name: 'addon', dependencies: { stream: '1', helper: '1' } });
    writePackage(path.join(projectDir, 'node_modules', 'stream'), { name: 'stream', version: '1.0.0' });
    fs.symlinkSync(path.join(store, 'helper'), path.join(projectDir, 'node_modules', 'helper'));

    const copied = await copyNativeAddons({ addons: ['addon'], projectDir, serverDir });

    expect(relativeDests(copied)).toEqual([
      'node_modules/addon',
      'node_modules/helper',
      'node_modules/helper/node_modules/stream',
      'node_modules/stream',
    ]);
    const versionAt = (rel: string) =>
      (JSON.parse(fs.readFileSync(path.join(serverDir, rel, 'package.json'), 'utf8')) as { version: string }).version;
    expect(versionAt('node_modules/stream')).toBe('1.0.0');
    expect(versionAt('node_modules/helper/node_modules/stream')).toBe('2.0.0');
  });

  it('keeps a version nested inside a package together with that package', async () => {
    writePackage(path.join(projectDir, 'node_modules', 'addon'), { name: 'addon', dependencies: { stream: '1', helper: '1' } });
    writePackage(path.join(projectDir, 'node_modules', 'stream'), { name: 'stream', version: '1.0.0' });
    writePackage(path.join(projectDir, 'node_modules', 'helper'), { name: 'helper', dependencies: { stream: '2' } });
    writePackage(path.join(projectDir, 'node_modules', 'helper', 'node_modules', 'stream'), {
      name: 'stream',
      version: '2.0.0',
    });

    const copied = await copyNativeAddons({ addons: ['addon'], projectDir, serverDir });

    expect(relativeDests(copied)).toEqual(['node_modules/addon', 'node_modules/helper', 'node_modules/stream']);
    const nestedStream = JSON.parse(
      fs.readFileSync(path.join(serverDir, 'node_modules/helper/node_modules/stream/package.json'), 'utf8'),
    ) as { version: string };
    expect(nestedStream.version).toBe('2.0.0');
  });

  it('places the hoisted dependencies of a package nested inside the addon', async () => {
    writePackage(path.join(projectDir, 'node_modules', 'addon'), { name: 'addon', dependencies: { inner: '1' } });
    writePackage(path.join(projectDir, 'node_modules', 'addon', 'node_modules', 'inner'), {
      name: 'inner',
      dependencies: { shared: '1' },
    });
    writePackage(path.join(projectDir, 'node_modules', 'shared'), { name: 'shared' });

    const copied = await copyNativeAddons({ addons: ['addon'], projectDir, serverDir });

    expect(relativeDests(copied)).toEqual(['node_modules/addon', 'node_modules/shared']);
    expect(fs.existsSync(path.join(serverDir, 'node_modules/addon/node_modules/inner/package.json'))).toBe(true);
  });

  it('fails, naming both packages, when a required dependency is not installed', async () => {
    writePackage(path.join(projectDir, 'node_modules', 'addon'), { name: 'addon', dependencies: { gone: '1' } });
    await expect(copyNativeAddons({ addons: ['addon'], projectDir, serverDir })).rejects.toThrow(
      'Native addon "addon" depends on "gone", which is not installed. Reinstall the project\'s dependencies.',
    );
  });

  it('fails, naming the addon, when the addon is not installed', async () => {
    await expect(copyNativeAddons({ addons: ['absent-addon'], projectDir, serverDir })).rejects.toThrow(
      `Native addon "absent-addon" (build.dependencies.nativeAddons) is not installed under ${projectDir}/node_modules. Install it, or remove it from nativeAddons.`,
    );
  });

  it('copies required peer dependencies and skips optional ones that are not installed', async () => {
    writePackage(path.join(projectDir, 'node_modules', 'addon'), {
      name: 'addon',
      peerDependencies: { 'peer-lib': '*', 'optional-peer': '*' },
      peerDependenciesMeta: { 'optional-peer': { optional: true } },
    });
    writePackage(path.join(projectDir, 'node_modules', 'peer-lib'), { name: 'peer-lib' });

    const copied = await copyNativeAddons({ addons: ['addon'], projectDir, serverDir });

    expect(relativeDests(copied)).toEqual(['node_modules/addon', 'node_modules/peer-lib']);
  });

  it('keeps a listed addon at the top when another one carries a different version of it nested', async () => {
    writePackage(path.join(projectDir, 'node_modules', 'x'), { name: 'x', dependencies: { d: '*' } });
    writePackage(path.join(projectDir, 'node_modules', 'x', 'node_modules', 'd'), { name: 'd', dependencies: { e: '2' } });
    writePackage(
      path.join(projectDir, 'node_modules', 'x', 'node_modules', 'e'),
      { name: 'e', version: '2.0.0' },
      { 'only-in-e2.js': '' },
    );
    writePackage(path.join(projectDir, 'node_modules', 'e'), { name: 'e', version: '1.0.0' });

    const copied = await copyNativeAddons({ addons: ['x', 'e'], projectDir, serverDir });

    expect(relativeDests(copied)).toEqual(['node_modules/e', 'node_modules/x']);
    const versionAt = (rel: string) =>
      (JSON.parse(fs.readFileSync(path.join(serverDir, rel, 'package.json'), 'utf8')) as { version: string }).version;
    expect(versionAt('node_modules/e')).toBe('1.0.0');
    expect(fs.existsSync(path.join(serverDir, 'node_modules/e/only-in-e2.js'))).toBe(false);
    expect(versionAt('node_modules/x/node_modules/e')).toBe('2.0.0');
  });

  it('refuses a dependency name that is not a package name, and writes nothing outside server/node_modules', async () => {
    writePackage(path.join(projectDir, 'node_modules', 'addon'), { name: 'addon', dependencies: { '../../../escape': '*' } });
    writePackage(path.join(projectDir, 'escape'), { name: 'escape' }, { 'secret.txt': 'x' });

    await expect(copyNativeAddons({ addons: ['addon'], projectDir, serverDir })).rejects.toThrow(
      'Native addon "addon" depends on "../../../escape", which is not a valid package name.',
    );
    expect(fs.existsSync(path.resolve(serverDir, 'node_modules', '../../../escape'))).toBe(false);
  });

  it('refuses a listed addon whose name is not a package name', async () => {
    await expect(copyNativeAddons({ addons: ['../outside'], projectDir, serverDir })).rejects.toThrow(
      '"../outside" in build.dependencies.nativeAddons is not a valid package name.',
    );
  });

  it('leaves .git folders out of the copy', async () => {
    writePackage(path.join(projectDir, 'node_modules', 'addon'), { name: 'addon' }, { '.git/config': '[core]', 'addon.node': 'binary' });

    await copyNativeAddons({ addons: ['addon'], projectDir, serverDir });

    expect(fs.existsSync(path.join(serverDir, 'node_modules/addon/addon.node'))).toBe(true);
    expect(fs.existsSync(path.join(serverDir, 'node_modules/addon/.git'))).toBe(false);
  });

  it('copies nothing when no addon is listed', async () => {
    expect(await copyNativeAddons({ addons: [], projectDir, serverDir })).toEqual([]);
    expect(fs.existsSync(path.join(serverDir, 'node_modules'))).toBe(false);
  });

  it('names the build machine OS when MCPB can express it', () => {
    const expected = ['darwin', 'linux', 'win32'].includes(process.platform) ? process.platform : undefined;
    expect(buildMachinePlatform()).toBe(expected);
  });
});
