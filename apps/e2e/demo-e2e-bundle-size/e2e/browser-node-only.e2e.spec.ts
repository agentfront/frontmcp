/**
 * The browser builds reach no Node built-in, and the Node-only entry points refuse to run in a page (#1034). webpack 5
 * has no Node polyfills and fails on any built-in a build imports. A Node-only feature loads its built-ins on first use
 * (esbuild's `__require`, which no bundler follows) or sits behind a `#` subpath import whose browser variant is a stub.
 *
 * Needs the packages built: `nx run-many -t build -p sdk plugin-webmcp`.
 */
import { execFileSync } from 'node:child_process';
import { isBuiltin } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { build } from 'esbuild';

import { mkdtemp, rm } from '@frontmcp/utils';

import { bundleWithWebpack, fixtureDir, workspaceRoot } from './helpers/browser-bundle';

const BROWSER_ENTRIES = [
  '@frontmcp/sdk',
  '@frontmcp/utils',
  '@frontmcp/auth',
  '@frontmcp/protocol',
  '@frontmcp/protocol/client',
];

/** Each Node built-in the entry's browser build imports, statically or with import(), as `<file> imports <built-in>`. */
async function nodeBuiltinImports(entry: string): Promise<string[]> {
  const imports: string[] = [];
  await build({
    stdin: { contents: `export * from '${entry}';`, resolveDir: workspaceRoot },
    absWorkingDir: workspaceRoot,
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    tsconfigRaw: {},
    logLevel: 'silent',
    plugins: [
      {
        name: 'follow-the-package-only',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /.*/ }, (args) => {
            if (isBuiltin(args.path)) {
              imports.push(`${relative(workspaceRoot, args.importer)} imports ${args.path}`);
              return { path: args.path, external: true };
            }
            const ownModule = args.importer === '<stdin>' || /^[.#]/.test(args.path);
            return ownModule ? undefined : { path: args.path, external: true };
          });
        },
      },
    ],
  });
  return imports;
}

describe('the browser builds and Node built-ins', () => {
  it.each(BROWSER_ENTRIES)('the browser build of %s imports no Node built-in', async (entry) => {
    expect(await nodeBuiltinImports(entry)).toEqual([]);
  });

  it('a page refuses runShared() and runUnixSocket(), which need Node', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'frontmcp-node-only-'));
    try {
      const pageBundle = join(outDir, 'page.mjs');
      await bundleWithWebpack('web', resolve(fixtureDir, 'node-only-entry-points.mjs'), pageBundle);
      const runner = resolve(__dirname, 'helpers/run-in-web-worker.mjs');
      const refusals = JSON.parse(
        execFileSync(process.execPath, [runner, pageBundle], { encoding: 'utf8', timeout: 60000 }),
      );
      expect(refusals).toEqual({
        runShared: {
          code: 'BROWSER_ENTRY_POINT_UNAVAILABLE',
          message: expect.stringMatching(/^A browser cannot run runShared\(\): /),
        },
        runUnixSocket: {
          code: 'BROWSER_ENTRY_POINT_UNAVAILABLE',
          message: expect.stringMatching(/^A browser cannot run runUnixSocket\(\): /),
        },
      });
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
