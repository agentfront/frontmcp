import { existsSync } from 'fs';
import * as path from 'path';

export interface TsPathAliases {
  /** Directory the `paths` targets are relative to. */
  basePath: string;
  /** The tsconfig `compilerOptions.paths` map. */
  paths: Record<string, string[]>;
}

/**
 * Read `compilerOptions.paths` (following `extends`) with the project's own TypeScript.
 * Returns `undefined` when TypeScript is not installed or the project declares no aliases.
 */
export function readTsPathAliases(tsconfigPath: string, cwd: string): TsPathAliases | undefined {
  let ts: typeof import('typescript');
  try {
    ts = require(require.resolve('typescript', { paths: [cwd] })) as typeof import('typescript');
  } catch {
    return undefined;
  }
  const read = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (read.error || !read.config) return undefined;
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(tsconfigPath));
  const paths = parsed.options.paths;
  if (!paths || Object.keys(paths).length === 0) return undefined;
  const basePath = parsed.options.baseUrl ?? (parsed.options['pathsBasePath'] as string | undefined) ?? cwd;
  return { basePath, paths };
}

/**
 * Bundler aliases pointing every tsconfig path alias at the JavaScript `tsc` emitted for it.
 *
 * `tsc` leaves `import '@scope/lib'` untouched, so a bundler run over the emitted output cannot
 * find code that lives in another workspace project. `tsc` mirrors the sources under `outDir`,
 * so a source file maps to `emittedEntryDir/<path relative to the entry's folder>`.
 */
export function buildEmittedAliases(
  aliases: TsPathAliases,
  entryDir: string,
  emittedEntryDir: string,
  exists: (file: string) => boolean = existsSync,
): Record<string, string> {
  const result: Record<string, string> = {};

  const emitted = (source: string): string =>
    path.join(emittedEntryDir, path.relative(entryDir, source)).replace(/\.(d\.)?tsx?$/, '.js');

  for (const [alias, targets] of Object.entries(aliases.paths)) {
    const isWildcard = alias.endsWith('/*');
    for (const target of targets) {
      const source = path.resolve(aliases.basePath, isWildcard ? target.replace(/\/\*$/, '') : target);
      const candidate = emitted(source);
      if (isWildcard) {
        if (exists(candidate)) {
          result[alias.slice(0, -2)] = candidate;
          break;
        }
      } else {
        const hasExtension = /\.(d\.)?tsx?$/.test(source);
        const file = hasExtension
          ? candidate
          : [`${candidate}.js`, path.join(candidate, 'index.js')].find((option) => exists(option));
        if (file && exists(file)) {
          result[`${alias}$`] = file;
          break;
        }
      }
    }
  }
  return result;
}
