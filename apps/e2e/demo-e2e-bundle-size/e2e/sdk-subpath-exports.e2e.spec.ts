/**
 * The published exports map of @frontmcp/sdk names only files its build emits, and each subpath hands back the root
 * entry's own classes and functions: under require() and import in Node, and in a browser bundle.
 *
 * Needs the packages built: `nx run-many -t build -p sdk plugin-webmcp`.
 */
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { copyFile, fileExists, mkdir, mkdtemp, readFileSync, rm, symlink } from '@frontmcp/utils';

import { bundleForBrowser, fixtureDir, inputSizes, SERVER_MODULES, workspaceRoot } from './helpers/browser-bundle';

type Loader = 'require' | 'import';

const sdkDist = resolve(workspaceRoot, 'libs/sdk/dist');
const exportsMap: Record<string, unknown> = JSON.parse(readFileSync(join(sdkDist, 'package.json'))).exports;
const SUBPATHS = Object.keys(exportsMap)
  .filter((key) => key !== '.' && key !== './package.json' && exportsMap[key] !== null)
  .map((key) => key.slice('./'.length));

function exportTargets(entry: unknown): string[] {
  if (typeof entry === 'string') return [entry];
  if (entry === null || typeof entry !== 'object') return [];
  return Object.values(entry).flatMap(exportTargets);
}

describe('the exports map of the published @frontmcp/sdk', () => {
  it('names only files its build emits', async () => {
    const targets = exportTargets(exportsMap);
    const missing: string[] = [];
    for (const target of targets) {
      if (!(await fileExists(join(sdkDist, target)))) missing.push(target);
    }

    expect(targets.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});

describe('a subpath of @frontmcp/sdk installed in a project', () => {
  let project: string;

  beforeAll(async () => {
    project = await mkdtemp(join(tmpdir(), 'frontmcp-sdk-subpaths-'));
    await mkdir(join(project, 'node_modules', '@frontmcp'), { recursive: true });
    await symlink(sdkDist, join(project, 'node_modules', '@frontmcp', 'sdk'), 'dir');
    await copyFile(resolve(__dirname, 'helpers', 'subpath-exports.mjs'), join(project, 'subpath-exports.mjs'));
  });

  afterAll(async () => {
    if (project) await rm(project, { recursive: true, force: true });
  });

  function subpathExports(subpath: string, loader: Loader): { names: string[]; notFromRoot: string[] } {
    return JSON.parse(
      execFileSync(process.execPath, [join(project, 'subpath-exports.mjs'), subpath, loader], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  }

  describe.each(SUBPATHS)('@frontmcp/sdk/%s', (subpath) => {
    it.each<Loader>(['require', 'import'])("hands back the root entry's own values under %s", (loader) => {
      const { names, notFromRoot } = subpathExports(subpath, loader);

      expect(names.length).toBeGreaterThan(0);
      expect(notFromRoot).toEqual([]);
    });

    it('exports the same names under require and import', () => {
      expect(subpathExports(subpath, 'import').names).toEqual(subpathExports(subpath, 'require').names);
    });
  });
});

describe('a browser bundle of the subpaths of @frontmcp/sdk', () => {
  it('takes their values from the browser build the root entry comes from', async () => {
    const bundle = await bundleForBrowser(resolve(fixtureDir, 'subpath-imports.mjs'), SERVER_MODULES);
    const sdkInputs = inputSizes(bundle.metafile)
      .map(([input]) => input)
      .filter((input) => input.startsWith('libs/sdk/dist/'));

    expect(sdkInputs).toContain('libs/sdk/dist/browser/job/tools/execute-job.tool.mjs');
    expect(sdkInputs.filter((input) => !input.startsWith('libs/sdk/dist/browser/'))).toEqual([]);
  });
});
