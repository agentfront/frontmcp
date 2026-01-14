import { rspack } from '@rspack/core';
import { c } from '../../colors.js';

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
    },
    resolve: {
      extensions: ['.js', '.mjs', '.cjs', '.json'],
      // Allow imports without file extensions (TypeScript compiles without .js but ESM requires them)
      fullySpecified: false,
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
