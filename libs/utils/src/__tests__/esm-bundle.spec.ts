/**
 * The ESM bundle (`dist/esm/index.mjs`) is what browser bundlers (Vite, esbuild) read. It is built
 * here with the options of the `build-esm` target, then checked for what broke those builds in 1.9.2:
 * a static `node:crypto` import, and an `import('@upstash/redis')` of a package utils did not declare.
 */
import { builtinModules } from 'module';
import * as path from 'path';

const packageRoot = path.resolve(__dirname, '../..');

interface EsmBuildOptions {
  main: string;
  esbuildOptions: { external: string[] };
}

function buildEsmIndex(): string {
  const esbuild = require('esbuild') as typeof import('esbuild');
  const project = require(path.join(packageRoot, 'project.json')) as {
    targets: { 'build-esm': { options: EsmBuildOptions } };
  };
  const { main, esbuildOptions } = project.targets['build-esm'].options;
  const result = esbuild.buildSync({
    entryPoints: [path.resolve(packageRoot, '../..', main)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    external: esbuildOptions.external,
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

function importedSpecifiers(code: string): { static: string[]; dynamic: string[] } {
  const staticImports = [...code.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*"([^"]+)"/gm)].map((m) => m[1]);
  const sideEffectImports = [...code.matchAll(/^\s*import\s*"([^"]+)"/gm)].map((m) => m[1]);
  const dynamicImports = [...code.matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]);
  return { static: [...staticImports, ...sideEffectImports], dynamic: dynamicImports };
}

function packageNameOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith('node:') || builtinModules.includes(specifier);
}

describe('@frontmcp/utils ESM bundle', () => {
  const code = buildEsmIndex();
  const { static: staticImports, dynamic: dynamicImports } = importedSpecifiers(code);

  it('imports no Node built-in statically, so a browser bundle resolves', () => {
    expect(staticImports.length).toBeGreaterThan(0);
    expect(staticImports.filter(isNodeBuiltin)).toEqual([]);
  });

  it('declares every package it imports, so a bundler can tell an optional peer from a missing one', () => {
    const pkg = require(path.join(packageRoot, 'package.json')) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]);
    const packages = [...staticImports, ...dynamicImports]
      .filter((specifier) => !specifier.startsWith('#') && !specifier.startsWith('.') && !isNodeBuiltin(specifier))
      .map(packageNameOf);

    expect(dynamicImports).toContain('@upstash/redis');
    expect([...new Set(packages)].filter((name) => !declared.has(name))).toEqual([]);
  });
});
