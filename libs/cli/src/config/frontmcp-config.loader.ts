/**
 * FrontMCP Config Loader
 *
 * Loads `frontmcp.config.(json|js|ts|mjs|cjs)` from a directory.
 * Falls back to deriving minimal config from package.json.
 */

import {
  basename,
  dirname,
  fileExists,
  isAbsolute,
  pathJoin,
  pathResolve,
  pathToFileURL,
  readFile,
} from '@frontmcp/utils';

import { frontmcpConfigSchema, type FrontMcpConfigParsed } from './frontmcp-config.schema';
import type { DeploymentTarget, FrontMcpConfig } from './frontmcp-config.types';

const CONFIG_FILENAMES = [
  'frontmcp.config.ts',
  'frontmcp.config.js',
  'frontmcp.config.json',
  'frontmcp.config.mjs',
  'frontmcp.config.cjs',
];

/**
 * Load and validate a frontmcp.config file from the given directory.
 *
 * Resolution order:
 * 1. frontmcp.config.ts
 * 2. frontmcp.config.js
 * 3. frontmcp.config.json
 * 4. frontmcp.config.mjs
 * 5. frontmcp.config.cjs
 * 6. Derive from package.json (minimal config with 'node' target)
 */
export async function loadFrontMcpConfig(cwd: string): Promise<FrontMcpConfigParsed> {
  const raw = await loadRawConfig(cwd);
  return validateConfig(raw);
}

/**
 * Load a specific config file by absolute or cwd-relative path. Used by the
 * `--config <path>` flag and the `FRONTMCP_CONFIG` env var (issue #400).
 *
 * Unlike `loadFrontMcpConfig`, this doesn't search `CONFIG_FILENAMES` — the
 * caller already named the file, so a missing-file error is a hard failure
 * (no silent fallback to `deriveFromPackageJson`).
 */
export async function loadFrontMcpConfigFromFile(configPath: string): Promise<FrontMcpConfigParsed> {
  const absolutePath = isAbsolute(configPath) ? configPath : pathResolve(process.cwd(), configPath);
  if (!(await fileExists(absolutePath))) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const filename = basename(absolutePath);
  const raw = await loadRawFileAtPath(absolutePath, filename);
  return validateConfig(raw);
}

/**
 * Locate the nearest `frontmcp.config.*` file by walking upward from `cwd`.
 *
 * Issue #400 — monorepo nested apps no longer require `cd <repo-root>`
 * before invoking the CLI. The walk caps at 10 levels to avoid pathological
 * symlink loops.
 *
 * Returns the directory containing the config (so callers can pass it to
 * `loadFrontMcpConfig(dir)`), or `undefined` if nothing was found.
 */
export async function findConfigDir(startDir: string, maxLevels = 10): Promise<string | undefined> {
  let current = pathResolve(startDir);
  for (let i = 0; i <= maxLevels; i++) {
    for (const filename of CONFIG_FILENAMES) {
      if (await fileExists(pathJoin(current, filename))) {
        return current;
      }
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return undefined;
}

/**
 * Variant that load-errors propagate (parse failures in `frontmcp.config.ts`,
 * missing dependencies, etc.) but schema-validation errors return `undefined`.
 *
 * Used by `runBuild` to support both shapes: the new top-level
 * `frontmcpConfigSchema` (with `deployments`) and the older exec-only shape
 * (top-level `cli`, `sea`, `esbuild`) that `loadExecConfig` consumes
 * directly. A user with the old shape should still get a successful build
 * — the exec-loader picks the file up from disk by itself.
 *
 * Returns `undefined` when:
 *  - no config file is present (caller falls back to CLI flags), or
 *  - the file loads but doesn't match the new schema (legacy shape).
 *
 * Throws when:
 *  - the file exists but can't be parsed (TS syntax error, ESM/CJS mismatch
 *    that even esbuild can't recover from, etc.) — i.e., #365 silent-default
 *    regressions.
 */
export async function tryLoadFrontMcpConfig(cwd: string): Promise<FrontMcpConfigParsed | undefined> {
  let raw: unknown;
  try {
    raw = await loadRawConfig(cwd);
  } catch (err) {
    // Distinguish "no config and no package.json" from real load failures.
    // `deriveFromPackageJson` throws this exact message — treat it as "no config".
    if ((err as Error).message?.startsWith('No frontmcp.config found')) {
      return undefined;
    }
    throw err;
  }
  return parseRawOrLegacy(raw);
}

/**
 * Explicit-path counterpart of {@link tryLoadFrontMcpConfig}. Used by
 * `resolveConfig` for the `--config <path>` / `FRONTMCP_CONFIG` branch so a
 * legacy exec-only config passed via explicit path resolves the same way
 * an auto-discovered one does: `config: undefined`, no throw, callers fall
 * back to `loadExecConfig`. Real parse failures still propagate.
 */
export async function tryLoadFrontMcpConfigFromFile(configPath: string): Promise<FrontMcpConfigParsed | undefined> {
  const absolutePath = isAbsolute(configPath) ? configPath : pathResolve(process.cwd(), configPath);
  if (!(await fileExists(absolutePath))) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const filename = basename(absolutePath);
  const raw = await loadRawFileAtPath(absolutePath, filename);
  return parseRawOrLegacy(raw);
}

/**
 * Schema-validate a raw config payload, returning `undefined` when it
 * matches the legacy exec-only shape (top-level `cli` / `sea` / `esbuild`,
 * no `deployments`) and throwing on every other parse failure. Shared
 * between the cwd-search and explicit-path soft loaders so they agree on
 * what "legacy" means.
 */
function parseRawOrLegacy(raw: unknown): FrontMcpConfigParsed | undefined {
  const result = frontmcpConfigSchema.safeParse(raw);
  if (!result.success) {
    // Distinguish two failure shapes:
    //   1. Legacy exec-only config — top-level `cli` / `sea` / `esbuild`,
    //      no `deployments` key. Return undefined so `loadExecConfig` picks
    //      it up directly. Pre-v1.1 fixtures live in this branch.
    //   2. Anything else — looks like the user attempted a v1.1 config and
    //      got it wrong (typo'd `deployments`, invalid `target`, etc.).
    //      Throw so we don't silently fall back to defaults — that was the
    //      silent-corruption mode #365 was trying to eliminate.
    const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : undefined;
    const isLegacyExecOnlyShape =
      !!obj && !('deployments' in obj) && ('cli' in obj || 'sea' in obj || 'esbuild' in obj);
    if (isLegacyExecOnlyShape) return undefined;
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid frontmcp.config:\n${issues}`);
  }
  return result.data;
}

/**
 * Load raw config without validation.
 */
async function loadRawConfig(cwd: string): Promise<unknown> {
  for (const filename of CONFIG_FILENAMES) {
    const configPath = pathJoin(cwd, filename);
    if (!(await fileExists(configPath))) continue;
    return loadRawFileAtPath(configPath, filename);
  }

  // Fallback: derive from package.json
  return deriveFromPackageJson(cwd);
}

/**
 * Load a single config file by absolute path (no search). Shared by
 * `loadRawConfig` (search-then-load) and `loadFrontMcpConfigFromFile`
 * (explicit-path).
 */
async function loadRawFileAtPath(configPath: string, filename: string): Promise<unknown> {
  if (filename.endsWith('.json')) {
    const content = await readFile(configPath);
    return JSON.parse(content);
  }

  if (filename.endsWith('.ts')) {
    const cwd = dirname(configPath);
    // #365 — Loading `.ts` under `"type": "commonjs"` (the default) is a
    // minefield across Node versions:
    //   - Node 20: `require()` throws on TS syntax, `await import()` errors
    //     with "Make sure to set type: module".
    //   - Node 22+: `require(esm)` may succeed but return partial data, OR
    //     emit a warning on `await import()` even when the load succeeds.
    //   - Node 24: type-stripping may swallow `import { x } from ...`
    //     statements, returning `{}` instead of the user's exports — the
    //     1.1.2-beta.1 silent-defaults regression.
    // Round 3: under CJS, ALWAYS transpile via esbuild. It's the only path
    // that produces a deterministic, fully-typed result. ESM projects can
    // still use Node's runtime loaders since they're well-behaved there.
    const isCjsProject = await isCommonJsProject(cwd);
    if (isCjsProject) {
      try {
        return await loadTsConfigViaEsbuild(configPath);
      } catch (esbuildErr) {
        throw new Error(
          `Failed to load ${filename} via esbuild.\n` +
            `  ${(esbuildErr as Error).message}\n` +
            `Hint: ensure the file exports a default config (e.g., ` +
            `\`export default defineConfig({...})\`) and that all imports resolve.`,
        );
      }
    }
    // ESM project ("type": "module"): try Node's loaders first (faster,
    // no transpile cost), fall back to esbuild on failure.
    let requireErr: Error | undefined;
    try {
      const mod = require(configPath);
      return mod.default ?? mod;
    } catch (e) {
      requireErr = e as Error;
    }
    try {
      // pathToFileURL — Windows absolute paths (e.g. `C:\…\frontmcp.config.ts`)
      // are not valid ESM specifiers; Node requires a `file://` URL.
      const mod = await import(pathToFileURL(configPath).href);
      return mod.default ?? mod;
    } catch {
      // Fall through to esbuild.
    }
    try {
      return await loadTsConfigViaEsbuild(configPath);
    } catch (esbuildErr) {
      throw new Error(
        `Failed to load ${filename}.\n` +
          `  require() error: ${requireErr?.message ?? '(skipped)'}\n` +
          `  esbuild error:   ${(esbuildErr as Error).message}\n` +
          `Hint: ensure the file exports a default config (e.g., ` +
          `\`export default defineConfig({...})\`) and that all imports resolve.`,
      );
    }
  }

  // JS/MJS/CJS
  if (filename.endsWith('.mjs')) {
    const mod = await import(pathToFileURL(configPath).href);
    return mod.default ?? mod;
  }

  const mod = require(configPath);
  return mod.default ?? mod;
}

/**
 * Read the host project's `package.json.type` to decide whether `await import()`
 * of a `.ts` file is worth attempting. Returns true when the project is
 * declared `"type": "commonjs"` or omits the field entirely (Node's default).
 *
 * Read errors (no package.json, malformed JSON) are treated as "CJS" — that's
 * the safer default for the loader because it routes us through esbuild
 * transpilation rather than relying on Node's experimental TS handling.
 *
 * Routed through `@frontmcp/utils` per repo convention so this module
 * doesn't reach into `node:fs` for an ad-hoc package.json read.
 */
async function isCommonJsProject(cwd: string): Promise<boolean> {
  try {
    const pkgPath = pathJoin(cwd, 'package.json');
    const contents = await readFile(pkgPath);
    const pkg = JSON.parse(contents) as { type?: string };
    return pkg.type !== 'module';
  } catch {
    return true;
  }
}

/**
 * Transpile a TypeScript config file with esbuild (CJS target) and eval the
 * result via Module-via-vm. Used as a last-resort path when neither `require()`
 * (no ts-node hook) nor `await import()` (project is `"type": "commonjs"`)
 * can load the file directly.
 *
 * Uses `esbuild.build({ bundle: true, packages: 'external' })` rather than
 * `transformSync` so a config that imports a sibling helper TS file
 * (`import { foo } from './helpers'`) gets the helper inlined into the
 * compiled output. Without bundling, the resulting CJS would emit
 * `require('./helpers')` which Node can't resolve under `"type": "commonjs"`.
 *
 * `packages: 'external'` keeps node_modules dependencies as runtime
 * `require()` calls so `import { defineConfig } from 'frontmcp'` still
 * resolves against the project's installed copy of the SDK.
 */
async function loadTsConfigViaEsbuild(configPath: string): Promise<unknown> {
  const esbuild = require('esbuild') as typeof import('esbuild');
  const built = await esbuild.build({
    entryPoints: [configPath],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    target: 'es2022',
    packages: 'external',
    sourcemap: 'inline',
    logLevel: 'silent',
  });
  if (!built.outputFiles || built.outputFiles.length === 0) {
    throw new Error('esbuild produced no output for ' + configPath);
  }
  const code = built.outputFiles[0].text;

  const Module = require('module') as typeof import('module');
  const m = new Module(configPath, module);
  // Make the loaded module's `require` resolve relative to the config dir
  // so user `import { defineConfig } from 'frontmcp'` keeps working.
  m.filename = configPath;
  m.paths = (Module as unknown as { _nodeModulePaths(p: string): string[] })._nodeModulePaths(dirname(configPath));

  (m as any)._compile(code, configPath);

  const exported = (m as any).exports as { default?: unknown };
  return exported?.default ?? exported;
}

/**
 * Derive minimal config from package.json.
 */
async function deriveFromPackageJson(cwd: string): Promise<FrontMcpConfig> {
  const pkgPath = pathJoin(cwd, 'package.json');
  if (!(await fileExists(pkgPath))) {
    throw new Error(
      'No frontmcp.config found and no package.json. Create a frontmcp.config.ts to configure build targets.',
    );
  }

  const pkg = JSON.parse(await readFile(pkgPath));
  return {
    name: pkg.name?.replace(/^@[^/]+\//, '') || basename(cwd),
    version: pkg.version || '1.0.0',
    entry: pkg.main,
    deployments: [{ target: 'node' }],
  };
}

/**
 * Validate raw config against the Zod schema.
 */
export function validateConfig(raw: unknown): FrontMcpConfigParsed {
  const result = frontmcpConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid frontmcp.config:\n${issues}`);
  }
  return result.data;
}

/**
 * Find a deployment target by type.
 */
export function findDeployment(config: FrontMcpConfigParsed, target: string): DeploymentTarget | undefined {
  return config.deployments.find((d) => d.target === target);
}

/**
 * Get all deployment target types from the config.
 */
export function getDeploymentTargets(config: FrontMcpConfigParsed): string[] {
  return config.deployments.map((d) => d.target);
}
