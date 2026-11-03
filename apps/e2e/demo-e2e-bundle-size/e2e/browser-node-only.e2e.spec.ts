/**
 * The browser builds reach no Node built-in, and the Node-only entry points refuse to run in a page (#1034). webpack 5
 * has no Node polyfills and fails on any built-in a build imports. A Node-only feature loads its built-ins on first use
 * (esbuild's `__require`, which no bundler follows) or sits behind a `#` subpath import whose browser variant is a stub.
 * A `__require` that runs while its module loads, outside any function, throws in a page: the guard catches it too.
 *
 * Needs the packages built: `nx run-many -t build -p sdk plugin-webmcp plugin-cache plugin-remember`.
 */
import { execFileSync } from 'node:child_process';
import { isBuiltin } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { build } from 'esbuild';
import * as ts from 'typescript';

import { mkdtemp, readFile, rm } from '@frontmcp/utils';

import { bundleWithWebpack, fixtureDir, workspaceRoot } from './helpers/browser-bundle';

const BROWSER_ENTRIES = [
  '@frontmcp/sdk',
  '@frontmcp/utils',
  '@frontmcp/auth',
  '@frontmcp/protocol',
  '@frontmcp/protocol/client',
  '@frontmcp/plugin-cache',
  '@frontmcp/plugin-remember',
];

/** A function that runs while its module loads: `(() => { ... })()`. */
function runsOnLoad(fn: ts.Node): boolean {
  let callee: ts.Node = fn;
  while (ts.isParenthesizedExpression(callee.parent)) callee = callee.parent;
  return ts.isCallExpression(callee.parent) && callee.parent.expression === callee;
}

/** The Node built-ins a module requires while it loads: `require()` or esbuild's `__require()` outside any function. */
function builtinsRequiredOnLoad(fileName: string, code: string): string[] {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const required: string[] = [];
  const visit = (node: ts.Node, inFunction: boolean): void => {
    if (!inFunction && ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const [specifier] = node.arguments;
      const requires = node.expression.text === 'require' || node.expression.text === '__require';
      if (requires && specifier && ts.isStringLiteral(specifier) && isBuiltin(specifier.text)) {
        required.push(specifier.text);
      }
    }
    const entersFunction = ts.isFunctionLike(node) && !runsOnLoad(node);
    ts.forEachChild(node, (child) => visit(child, inFunction || entersFunction));
  };
  visit(source, false);
  return required;
}

/**
 * Each Node built-in the entry's browser build imports, statically or with import(), as `<file> imports <built-in>`,
 * and each one a module requires while it loads, as `<file> requires <built-in> on load`.
 */
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
          pluginBuild.onLoad({ filter: /\.[cm]?js$/ }, async (args) => {
            const code = await readFile(args.path);
            for (const builtin of builtinsRequiredOnLoad(args.path, code)) {
              imports.push(`${relative(workspaceRoot, args.path)} requires ${builtin} on load`);
            }
            return { contents: code, loader: 'js' };
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

  it('finds a require() of a built-in that runs while its module loads, and not one in a function', () => {
    const code = [
      'var __require = ((x) => x)(function (x) { return require.apply(this, arguments); });',
      'var os = __require("node:os");',
      'var path = (() => require("path"))();',
      'function onFirstUse() { return __require("node:fs"); }',
      'const lazy = () => __require("node:url");',
    ].join('\n');

    expect(builtinsRequiredOnLoad('module.mjs', code)).toEqual(['node:os', 'path']);
  });

  it('the CommonJS browser build of @frontmcp/sdk requires @frontmcp/storage-sqlite on first use, not bundled', async () => {
    const cjs = await readFile(resolve(workspaceRoot, 'libs/sdk/dist/browser/index.cjs'));

    expect(cjs).toContain('require("@frontmcp/storage-sqlite")');
    expect(cjs).not.toContain('libs/storage-sqlite/');
    expect(cjs).not.toContain('require("node:events")');
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
