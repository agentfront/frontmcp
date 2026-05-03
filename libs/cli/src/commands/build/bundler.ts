import { rspack } from '@rspack/core';
import { c } from '../../core/colors';

/**
 * Bundle the serverless entry point into a single CJS file using rspack.
 * This resolves ESM/CJS compatibility issues and dynamic import problems.
 *
 * @param entryPath - Absolute path to the entry file (e.g., dist/index.js)
 * @param outDir - Output directory for the bundled file
 * @param outputFilename - Name of the output bundle (e.g., 'handler.cjs')
 */
export async function bundleForServerless(
  entryPath: string,
  outDir: string,
  outputFilename: string,
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
    externals: {
      '@swc/core': '@swc/core',
      fsevents: 'fsevents',
      esbuild: 'esbuild',
      // React is optional - only needed for MDX/JSX rendering
      react: 'react',
      'react-dom': 'react-dom',
      'react-dom/server': 'react-dom/server',
      'react/jsx-runtime': 'react/jsx-runtime',
      // #368 round-2 — Lambda's entry imports `@codegenie/serverless-express`
      // which is intentionally a peer dep (the user installs the version
      // they want). Mark it external so rspack doesn't fail with
      // "Module not found" trying to bundle it. The lambda adapter's own
      // validate hook surfaces a clear "npm install @codegenie/serverless-express"
      // error when it's actually missing from node_modules at build time.
      '@codegenie/serverless-express': '@codegenie/serverless-express',
    },
    resolve: {
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
    // Don't minimize to preserve readability for debugging
    optimization: {
      minimize: false,
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
