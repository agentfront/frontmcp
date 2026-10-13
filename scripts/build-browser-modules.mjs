// Builds a browser ESM entry as one module per source file, so an app's bundler can drop the modules it doesn't use
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
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

const ownExportsByOutput = new Map();

while (pendingSources.length > 0) {
  const { metafile } = await build({
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
    metafile: true,
    logLevel: 'warning',
  });
  for (const [outputPath, output] of Object.entries(metafile.outputs)) {
    ownExportsByOutput.set(resolve(outputPath), output.exports);
  }
}

// esbuild without splitting drops an `export *` barrel's init of a module also loaded by import(), so stars are named
const STAR_REEXPORT = /^export \* from "([^"]+)";$/gm;
const isRelative = (specifier) => specifier.startsWith('.');
const originalCodeByOutput = new Map(
  [...ownExportsByOutput.keys()].map((outputPath) => [outputPath, readFileSync(outputPath, 'utf8')]),
);
const starSpecifiersOf = (outputPath) =>
  [...(originalCodeByOutput.get(outputPath) ?? '').matchAll(STAR_REEXPORT)].map(([, specifier]) => specifier);

async function packageExportNames(packageName) {
  const bundleOnlyThisPackage = {
    name: 'bundle-only-this-package',
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^[^./]/ }, (args) =>
        args.importer === '<stdin>' ? undefined : { path: args.path, external: true },
      );
    },
  };
  const { metafile } = await build({
    stdin: { contents: `export * from '${packageName}';`, resolveDir: sourceRoot, loader: 'js' },
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'node',
    conditions: ['browser'],
    plugins: [bundleOnlyThisPackage],
    logLevel: 'warning',
  });
  return Object.values(metafile.outputs)[0].exports;
}

const packageExportsByName = new Map();
for (const outputPath of originalCodeByOutput.keys()) {
  for (const packageName of starSpecifiersOf(outputPath).filter((specifier) => !isRelative(specifier))) {
    if (!packageExportsByName.has(packageName))
      packageExportsByName.set(packageName, await packageExportNames(packageName));
  }
}

const exportedNamesCache = new Map();

function starExportNames(importerPath, specifier, ancestors) {
  const names = isRelative(specifier)
    ? exportedNamesOf(resolve(dirname(importerPath), specifier), ancestors)
    : packageExportsByName.get(specifier);
  return names.filter((name) => name !== 'default');
}

function exportedNamesOf(outputPath, ancestors = []) {
  if (exportedNamesCache.has(outputPath)) return exportedNamesCache.get(outputPath);
  if (ancestors.includes(outputPath)) return [];
  const starNames = starSpecifiersOf(outputPath).flatMap((specifier) =>
    starExportNames(outputPath, specifier, [...ancestors, outputPath]),
  );
  const exportedNames = [...new Set([...(ownExportsByOutput.get(outputPath) ?? []), ...starNames])];
  exportedNamesCache.set(outputPath, exportedNames);
  return exportedNames;
}

// A name two stars bring in is one binding: TypeScript rejects stars that bring in different ones (TS2308)
for (const [outputPath, originalCode] of originalCodeByOutput) {
  const claimedNames = new Set(ownExportsByOutput.get(outputPath));
  const rewrittenCode = originalCode.replace(STAR_REEXPORT, (_statement, specifier) => {
    const targetNames = starExportNames(outputPath, specifier, []).filter((name) => !claimedNames.has(name));
    for (const name of targetNames) claimedNames.add(name);
    if (targetNames.length === 0) return `import "${specifier}";`;
    return `export { ${targetNames.join(', ')} } from "${specifier}";`;
  });
  if (rewrittenCode !== originalCode) writeFileSync(outputPath, rewrittenCode);
}

console.log(`build-browser-modules: ${discoveredSources.size} modules in ${relative(process.cwd(), outdir)}`);
