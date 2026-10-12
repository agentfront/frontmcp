// Builds a browser ESM entry as one module per source file, so an app's bundler can drop the modules it doesn't use
import { realpathSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import { build } from 'esbuild';

const [entryArg, outdirArg, tsconfig] = process.argv.slice(2);
if (!entryArg || !outdirArg || !tsconfig) {
  console.error('Usage: node scripts/build-browser-modules.mjs <entry.ts> <outdir> <tsconfig>');
  process.exit(1);
}

// esbuild reports real paths, so a checkout reached through a symlink must not skew the output layout
const entry = realpathSync(resolve(entryArg));
const sourceRoot = dirname(entry);
const outdir = resolve(outdirArg);
const pendingSources = [entry];
const discoveredSources = new Set(pendingSources);

const outputPathOf = (sourcePath) => resolve(outdir, relative(sourceRoot, sourcePath)).replace(/\.tsx?$/, '.mjs');

const rewriteInternalImports = {
  name: 'rewrite-internal-imports',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /.*/ }, async (args) => {
      if (args.kind === 'entry-point' || args.pluginData?.resolving) return undefined;
      const isInternal = args.path.startsWith('.') || args.path.startsWith('#');
      if (!isInternal) return { path: args.path, external: true };
      if (args.kind === 'require-call') {
        // A subpath import's browser variant is a dependency-free stub, so it is inlined where it is required
        if (args.path.startsWith('#')) return undefined;
        return { errors: [{ text: `require('${args.path}') of an internal module has no browser ESM equivalent` }] };
      }
      const resolved = await pluginBuild.resolve(args.path, {
        kind: args.kind,
        importer: args.importer,
        resolveDir: args.resolveDir,
        pluginData: { resolving: true },
      });
      if (resolved.errors.length > 0) return { errors: resolved.errors };
      if (!discoveredSources.has(resolved.path)) {
        discoveredSources.add(resolved.path);
        pendingSources.push(resolved.path);
      }
      const specifier = relative(dirname(outputPathOf(args.importer)), outputPathOf(resolved.path));
      return { path: specifier.startsWith('.') ? specifier : `./${specifier}`, external: true };
    });
  },
};

while (pendingSources.length > 0) {
  await build({
    entryPoints: pendingSources.splice(0),
    outbase: sourceRoot,
    outdir,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    format: 'esm',
    platform: 'node',
    conditions: ['browser'],
    tsconfig,
    plugins: [rewriteInternalImports],
    logLevel: 'warning',
  });
}

console.log(`build-browser-modules: ${discoveredSources.size} modules in ${relative(process.cwd(), outdir)}`);
