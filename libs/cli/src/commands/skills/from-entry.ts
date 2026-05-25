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

import * as os from 'os';
import * as path from 'path';

import { mkdtemp, rm } from '@frontmcp/utils';

import type { ExtractedSkillAsset } from '../build/exec/cli-runtime/schema-extractor';

export interface FromEntryOptions {
  /** Absolute path to the entry file (TypeScript or JavaScript). */
  entry: string;
  /** Working directory used by esbuild for resolving relative imports. */
  cwd: string;
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
 * the produced CJS bundle. Returns the enumerated skill assets.
 *
 * Temporary bundle dir is cleaned up before return regardless of outcome.
 */
export async function extractProjectSkills(opts: FromEntryOptions): Promise<ExtractedSkillAsset[]> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-skills-from-'));
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
      sourcemap: false,
      logLevel: 'silent',
      absWorkingDir: opts.cwd,
    });
    const { extractSchemas } = await import('../build/exec/cli-runtime/schema-extractor.js');
    const schema = await extractSchemas(bundlePath);
    return schema.skillAssets ?? [];
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function createRequire(cwd: string): NodeJS.Require {
  // Anchor resolution to the project's own dependency tree, not the CLI's.
  // We synthesize a require() bound to a virtual path inside `cwd` so
  // node_modules lookups walk up from there.
  const nodeModule = require('module') as { createRequire: (p: string) => NodeJS.Require };
  return nodeModule.createRequire(path.join(cwd, 'package.json'));
}
