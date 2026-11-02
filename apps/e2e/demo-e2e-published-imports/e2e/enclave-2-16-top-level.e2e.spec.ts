// 1.10.9 failed here with ERR_PACKAGE_PATH_NOT_EXPORTED: bundled utils code resolved the top-level @enclave-vm/ast, which has no ./redos (#956)
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { mkdir, mkdtemp, readJSON, rm, writeJSON } from '@frontmcp/utils';

import {
  builtDistDir,
  internalClosure,
  packPackage,
  workspaceDistDirs,
  type PackageManifest,
} from './helpers/published-package';

const PACKAGES = ['@frontmcp/plugin-cache', '@frontmcp/plugin-dashboard', '@frontmcp/edge'];
const TOP_LEVEL_ENCLAVE = '2.16.0';

function load(project: string, args: string[]): string {
  const result = spawnSync(process.execPath, args, { cwd: project, encoding: 'utf8', timeout: 60_000 });
  if (result.status === 0) return 'loaded';
  return result.stderr || `exited with ${result.signal ?? result.status}`;
}

describe(`a fresh npm project with @enclave-vm/ast ${TOP_LEVEL_ENCLAVE} at the top level`, () => {
  let project: string;

  beforeAll(async () => {
    project = await mkdtemp(path.join(tmpdir(), 'frontmcp-enclave-2-16-'));
    const tarballs = path.join(project, 'tarballs');
    await mkdir(tarballs);
    const distDirs = await workspaceDistDirs();
    const dependencies: Record<string, string> = { '@enclave-vm/ast': TOP_LEVEL_ENCLAVE };
    for (const name of await internalClosure(PACKAGES, distDirs)) {
      dependencies[name] = `file:${packPackage(await builtDistDir(distDirs, name), tarballs).tarball}`;
    }
    await writeJSON(path.join(project, 'package.json'), { name: 'enclave-2-16-project', private: true, dependencies });
    execFileSync('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts'], {
      cwd: project,
      stdio: 'pipe',
      timeout: 240_000,
    });
  }, 300_000);

  afterAll(async () => {
    if (project) await rm(project, { recursive: true, force: true });
  });

  it(`keeps @enclave-vm/ast ${TOP_LEVEL_ENCLAVE} at the top level`, async () => {
    const manifest = await readJSON<PackageManifest>(
      path.join(project, 'node_modules', '@enclave-vm', 'ast', 'package.json'),
    );
    expect(manifest?.version).toBe(TOP_LEVEL_ENCLAVE);
  });

  it.each(PACKAGES)('%s loads with require', (name) => {
    expect(load(project, ['-e', `require(${JSON.stringify(name)})`])).toBe('loaded');
  });

  it.each(PACKAGES)('%s loads with import', (name) => {
    expect(load(project, ['--input-type=module', '-e', `await import(${JSON.stringify(name)})`])).toBe('loaded');
  });
});
