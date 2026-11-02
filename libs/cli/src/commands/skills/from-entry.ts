/**
 * Project-side resolver for `frontmcp skills install --from-entry` and
 * `--from-package`. Bundles the given entry once via esbuild, then boots the
 * SDK through the existing schema extractor to enumerate `@Skill`-decorated
 * entries. Returns the raw `ExtractedSkillAsset` list — caller decides how to
 * filter (single skill, `--all`, by tag, …) and how to materialize the files.
 *
 * Lives in the skills command tree (not in install/) so the catalog install
 * path can reuse it without depending on the per-bin install module.
 */

import * as path from 'path';

import { mkdtemp, rm } from '@frontmcp/utils';

import type { ExtractedSchema, ExtractedSkillAsset } from '../build/exec/cli-runtime/schema-extractor';

export interface FromEntryOptions {
  /** Absolute path to the entry file (TypeScript or JavaScript). */
  entry: string;
  /** Working directory used by esbuild for resolving relative imports. */
  cwd: string;
  /** How long the server may take to boot before the extraction stops waiting for it. */
  bootTimeoutMs?: number;
}

/** The default of {@link FromEntryOptions.bootTimeoutMs}. */
export const EXTRACT_BOOT_TIMEOUT_MS = 60_000;

/** The extraction, or a rejection once `timeoutMs` passes: a boot that waits forever must not hang the build. */
function withinBootTimeout<T>(extraction: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `The server did not finish booting within ${timeoutMs / 1000} s: a provider, plugin, adapter or remote ` +
              'app may be waiting for a service this machine cannot reach.',
          ),
        ),
      timeoutMs,
    );
  });
  return Promise.race([extraction, timedOut]).finally(() => clearTimeout(timer));
}

/**
 * Resolve a published package name to its main entry file. Uses Node's own
 * module resolution so we honor `exports`/`main` fields rather than guessing.
 *
 * @throws when the package cannot be resolved from `cwd`.
 */
export function resolvePackageEntry(pkg: string, cwd: string): string {
  const require = createRequire(cwd);
  return require.resolve(pkg);
}

/**
 * Bundle the project's entry with esbuild and run the schema extractor on
 * the produced CJS bundle. Packages stay external, so the bundle is written
 * inside `cwd`: Node resolves its bare `require`s by walking up from the
 * bundle's own directory, which from the OS temp dir finds no project deps.
 * The bundle carries a source map, so a skill's `instructions: { file }`
 * resolves against the source file that declared it.
 *
 * A server that has not booted after `bootTimeoutMs` fails the extraction.
 *
 * Temporary bundle dir is cleaned up before return regardless of outcome.
 */
export async function extractProjectSchema(opts: FromEntryOptions): Promise<ExtractedSchema> {
  const tempDir = await mkdtemp(path.join(opts.cwd, '.frontmcp-extract-'));
  const bundlePath = path.join(tempDir, 'entry.cjs');
  try {
    const esbuild = require('esbuild') as typeof import('esbuild');
    await esbuild.build({
      entryPoints: [opts.entry],
      bundle: true,
      write: true,
      outfile: bundlePath,
      platform: 'node',
      format: 'cjs',
      target: 'es2022',
      packages: 'external',
      sourcemap: 'inline',
      logLevel: 'silent',
      absWorkingDir: opts.cwd,
    });
    const { extractSchemas } = await import('../build/exec/cli-runtime/schema-extractor.js');
    // Stack traces name the source files, so the directory a decorator captures is the source's, not the bundle's
    const sourceMapsEnabled = process.sourceMapsEnabled;
    process.setSourceMapsEnabled(true);
    try {
      return await withinBootTimeout(extractSchemas(bundlePath), opts.bootTimeoutMs ?? EXTRACT_BOOT_TIMEOUT_MS);
    } finally {
      process.setSourceMapsEnabled(sourceMapsEnabled);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function extractProjectSkills(opts: FromEntryOptions): Promise<ExtractedSkillAsset[]> {
  const schema = await extractProjectSchema(opts);
  return schema.skillAssets ?? [];
}

function createRequire(cwd: string): NodeJS.Require {
  // Anchor resolution to the project's own dependency tree, not the CLI's.
  // We synthesize a require() bound to a virtual path inside `cwd` so
  // node_modules lookups walk up from there.
  const nodeModule = require('module') as { createRequire: (p: string) => NodeJS.Require };
  return nodeModule.createRequire(path.join(cwd, 'package.json'));
}
