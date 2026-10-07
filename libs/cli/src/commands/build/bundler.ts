import * as path from 'path';
import { rspack } from '@rspack/core';

import { fileExists } from '@frontmcp/utils';
import { c } from '../../core/colors';
import { OPTIONAL_RUNTIME_PEERS } from '../package/runtime-packages';

/**
 * The optional peers of `@frontmcp/sdk` and `@frontmcp/utils` (storage backends,
 * observability, Vercel KV, Upstash, ...), which they load lazily with `require()`
 * or `import()`. A fresh project has none of them installed, and rspack treats each
 * as a hard import — so a missing one failed the whole build with "Module not found".
 * They are bundled when installed and left as a runtime `require()` (which the SDK
 * already guards) when they are not.
 *
 * `@codegenie/serverless-express` is the Lambda entry's adapter. The lambda
 * target refuses to build without it, so for that target it is always installed
 * and therefore bundled: the deployed `dist/lambda/` (the generated SAM
 * template's `CodeUri`) carries no `node_modules`, and leaving it external made
 * the function fail to load (#680).
 */
export const OPTIONAL_RUNTIME_PACKAGES: readonly string[] = [
  ...OPTIONAL_RUNTIME_PEERS,
  '@codegenie/serverless-express',
];

/** Native addons can never be inlined into a single-file bundle. */
export const NATIVE_ADDON_PACKAGES = ['better-sqlite3'];

function packageNameOf(request: string): string {
  const parts = request.split('/');
  return request.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

// Walks node_modules upward from `from`, the way the bundler's resolver does.
async function isInstalled(name: string, from: string): Promise<boolean> {
  let dir = from;
  for (;;) {
    if (await fileExists(path.join(dir, 'node_modules', name, 'package.json'))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/**
 * rspack externals callback: externalize native addons always, and optional
 * runtime packages only when they are not installed.
 */
export function externalizeOptionalPackages(
  cwd: string,
): (data: { request?: string; context?: string }, callback: (err?: Error, result?: string) => void) => void {
  return ({ request, context }, callback) => {
    if (!request) return callback();
    const name = packageNameOf(request);
    if (NATIVE_ADDON_PACKAGES.includes(name)) return callback(undefined, `commonjs ${request}`);
    if (!OPTIONAL_RUNTIME_PACKAGES.includes(name)) return callback();
    isInstalled(name, context ?? cwd).then(
      (installed) => (installed ? callback() : callback(undefined, `commonjs ${request}`)),
      (err: Error) => callback(err),
    );
  };
}

/**
 * Bundle the serverless entry point into a single CJS file using rspack.
 * This resolves ESM/CJS compatibility issues and dynamic import problems.
 *
 * @param entryPath - Absolute path to the entry file (e.g., dist/index.js)
 * @param outDir - Output directory for the bundled file
 * @param outputFilename - Name of the output bundle (e.g., 'handler.cjs')
 * @param aliases - Extra module aliases (tsconfig `paths` pointing at the emitted output)
 */
export async function bundleForServerless(
  entryPath: string,
  outDir: string,
  outputFilename: string,
  aliases: Record<string, string> = {},
): Promise<void> {
  const compiler = rspack({
    mode: 'production',
    target: 'node',
    entry: entryPath,
    output: {
      path: outDir,
      filename: outputFilename,
      library: { type: 'commonjs2' },
      clean: false,
    },
    // Use node externals preset for built-in modules
    externalsPresets: { node: true },
    // Exclude problematic optional dependencies (native binaries that can't be bundled)
    externals: [
      externalizeOptionalPackages(process.cwd()),
      {
      '@swc/core': '@swc/core',
      fsevents: 'fsevents',
      esbuild: 'esbuild',
      // React is optional - only needed for MDX/JSX rendering
      react: 'react',
      'react-dom': 'react-dom',
      'react-dom/server': 'react-dom/server',
      'react/jsx-runtime': 'react/jsx-runtime',
      },
    ],
    resolve: {
      alias: aliases,
      extensions: ['.js', '.mjs', '.cjs', '.json'],
      // Allow imports without file extensions (TypeScript compiles without .js
      // but strict ESM requires them).
      //
      // #368 round-2 — top-level `fullySpecified: false` alone wasn't enough.
      // When the entry's sibling `package.json` declares `{"type":"module"}`
      // (vercel/lambda adapters do this so Node treats `index.js` as ESM),
      // rspack classifies the relative import edges as `esm` dependencies
      // and applies its strict-ESM resolver, which ignores the top-level
      // setting. `byDependency` overrides per dependency type so
      // `import { CalcApp } from './calc.app'` resolves whether the import
      // is parsed as CJS, ESM, or commonjs-require.
      fullySpecified: false,
      byDependency: {
        esm: { fullySpecified: false },
        commonjs: { fullySpecified: false },
        'commonjs-require': { fullySpecified: false },
      },
    },
    module: {
      rules: [],
      parser: {
        javascript: {
          // Handle dynamic requires like require('@vercel/kv') inside functions
          // by wrapping them instead of externalizing them
          dynamicImportMode: 'eager',
          exprContextCritical: false,
          unknownContextCritical: false,
        },
      },
    },
    // Don't minimize to preserve readability for debugging.
    // `nodeEnv: false` — `mode: 'production'` would otherwise replace every
    // `process.env.NODE_ENV` with the literal "production", so a function deployed
    // with NODE_ENV=development still reported production.
    optimization: {
      minimize: false,
      nodeEnv: false,
    },
    // Suppress known third-party library warnings that don't affect runtime
    ignoreWarnings: [
      // Express view engine dynamic require - expected behavior, harmless at runtime
      /Critical dependency: the request of a dependency is an expression/,
      // Handlebars require.extensions - deprecated Node.js API but works at runtime
      /require\.extensions is not supported by Rspack/,
    ],
    // Suppress verbose output
    stats: 'errors-warnings',
  });

  return new Promise((resolve, reject) => {
    compiler.run((err, stats) => {
      if (err) {
        return reject(err);
      }
      if (stats?.hasErrors()) {
        const info = stats.toJson();
        const errorMessages = info.errors?.map((e) => e.message).join('\n') || 'Unknown error';
        return reject(new Error(`Bundle failed:\n${errorMessages}`));
      }
      if (stats?.hasWarnings()) {
        const info = stats.toJson();
        info.warnings?.forEach((w) => {
          console.log(c('yellow', `  Warning: ${w.message}`));
        });
      }
      compiler.close((closeErr) => {
        if (closeErr) {
          console.log(c('yellow', `  Warning closing compiler: ${closeErr.message}`));
        }
        resolve();
      });
    });
  });
}
