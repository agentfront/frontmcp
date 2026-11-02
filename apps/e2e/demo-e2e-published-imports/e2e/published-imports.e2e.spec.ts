// The packed JavaScript of plugin-cache, plugin-dashboard and edge imports @frontmcp/utils instead of bundling it (#956)
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { mkdtemp, readFile, rm } from '@frontmcp/utils';

import {
  builtDistDir,
  definitionsNamed,
  exportedNames,
  loadedSpecifiers,
  readPublishedPackage,
  undeclaredImports,
  workspaceDistDirs,
  type PublishedPackage,
} from './helpers/published-package';

const PACKAGES = ['@frontmcp/plugin-cache', '@frontmcp/plugin-dashboard', '@frontmcp/edge'];

describe('published JavaScript that uses @frontmcp/utils', () => {
  let workDir: string;
  let distDirs: Map<string, string>;
  let utilsExports: Set<string>;

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'frontmcp-published-imports-'));
    distDirs = await workspaceDistDirs();
    const utilsEsm = path.join(await builtDistDir(distDirs, '@frontmcp/utils'), 'esm', 'index.mjs');
    utilsExports = exportedNames({ path: 'esm/index.mjs', source: await readFile(utilsEsm) });
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  describe.each(PACKAGES)('%s', (name) => {
    let published: PublishedPackage;

    beforeAll(async () => {
      published = await readPublishedPackage(await builtDistDir(distDirs, name), workDir);
    });

    it('declares @frontmcp/utils at its own version', () => {
      expect(published.manifest.dependencies?.['@frontmcp/utils']).toBe(published.manifest.version);
    });

    it('imports @frontmcp/utils from its CommonJS and ESM builds', () => {
      const importers = published.scripts
        .filter((script) => loadedSpecifiers(script).includes('@frontmcp/utils'))
        .map((script) => script.path);
      expect(importers).toEqual(expect.arrayContaining(['index.js', 'esm/index.mjs']));
    });

    it('defines none of the functions and classes @frontmcp/utils exports', () => {
      expect(utilsExports.size).toBeGreaterThan(0);
      expect(published.scripts.flatMap((script) => definitionsNamed(script, utilsExports))).toEqual([]);
    });

    it('imports only packages its package.json declares', () => {
      expect(undeclaredImports(published)).toEqual([]);
    });
  });
});
