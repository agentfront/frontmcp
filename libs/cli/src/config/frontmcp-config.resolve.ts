/**
 * Unified config resolver (issue #400).
 *
 * Single entry point each CLI command calls. Applies the precedence rules:
 *
 *   explicit CLI flag  >  FRONTMCP_<NAME> env var  >  frontmcp.config field  >  built-in default
 *
 * and returns a `ResolvedFrontMcpConfig` with all defaults applied, the
 * chosen deployment merged in, env overlays composed, and per-command
 * fields surfaced.
 *
 * Config-file resolution order (matches the plan's Phase 2):
 *   1. Explicit `--config <path>` CLI flag.
 *   2. `FRONTMCP_CONFIG` env var.
 *   3. Upward walk from `cwd` to the nearest `frontmcp.config.*`.
 *   4. None — caller uses defaults / falls back to package.json (handled
 *      by the existing `loadFrontMcpConfig` for the `build` command).
 *
 * Notes:
 *   - Resolve never throws when no config is present — it returns
 *     `{ config: undefined, ... }` with the merged env / transport values
 *     it could compute from CLI options.
 *   - The legacy exec-only config shape (top-level `cli` / `sea` /
 *     `esbuild`, no `deployments`) is still resolvable but produces a
 *     `config: undefined` so `loadExecConfig` can pick the file up.
 */

import { findConfigDir, loadFrontMcpConfig, loadFrontMcpConfigFromFile } from './frontmcp-config.loader';
import { type FrontMcpConfigParsed } from './frontmcp-config.schema';

/** Modes per command — used to choose which env overlay to apply. */
export type ResolveMode =
  | 'build:cli'
  | 'build:ship'
  | 'dev'
  | 'test'
  | 'inspector'
  | 'pm:start'
  | 'pm:socket'
  | 'skills';

export interface ResolveConfigOptions {
  /** Working directory the command was invoked from. */
  cwd: string;
  /** Effective command (drives env-overlay selection). */
  mode: ResolveMode;
  /** Explicit `--config <path>` from the CLI. */
  configPath?: string;
  /** Environment vars at invocation time (defaults to `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Already-parsed CLI options — values here win over the config. */
  cliOptions?: Record<string, unknown>;
}

export interface ResolvedFrontMcpConfig {
  /**
   * Parsed config when one was located + matched the schema. `undefined`
   * means "no config file found" or "file matched the legacy exec-only
   * shape" — callers must fall back to CLI/built-in defaults.
   */
  config?: FrontMcpConfigParsed;
  /** Directory that contained the resolved config. */
  configDir?: string;
  /** Absolute path to the resolved config file. */
  configPath?: string;
  /**
   * `process.env` ⊕ `config.env.shared` ⊕ `config.env.<mode>` ⊕
   * `cliOptions.env` (later wins). `.env`/`.env.local` are NOT applied
   * here — `dev`/`test` load those separately so they win for parity
   * with existing behavior.
   */
  effectiveEnv: Record<string, string>;
}

/** Map a `ResolveMode` to the env-overlay key (`'dev'`, `'test'`, `'ship'`). */
function modeToEnvKey(mode: ResolveMode): 'dev' | 'test' | 'ship' | undefined {
  switch (mode) {
    case 'dev':
    case 'inspector':
      return 'dev';
    case 'test':
      return 'test';
    case 'build:ship':
    case 'pm:start':
    case 'pm:socket':
      return 'ship';
    case 'build:cli':
    case 'skills':
      return undefined;
  }
}

/**
 * Resolve the config + env for the current command.
 *
 * Side-effect-free — call sites apply the returned `effectiveEnv` to the
 * spawned child themselves (`dev` adds `.env`/`.env.local` on top, etc.).
 */
export async function resolveConfig(options: ResolveConfigOptions): Promise<ResolvedFrontMcpConfig> {
  const env = options.env ?? process.env;
  const cliEnv =
    typeof options.cliOptions?.['env'] === 'object' && options.cliOptions['env'] !== null
      ? (options.cliOptions['env'] as Record<string, string>)
      : {};

  // ── Locate the config file ──
  const explicitPath = options.configPath ?? env['FRONTMCP_CONFIG'];
  let config: FrontMcpConfigParsed | undefined;
  let configPath: string | undefined;
  let configDir: string | undefined;

  if (explicitPath) {
    try {
      config = await loadFrontMcpConfigFromFile(explicitPath);
      configPath = explicitPath;
    } catch (err) {
      throw new Error(`Failed to load config from "${explicitPath}": ${(err as Error).message}`);
    }
  } else {
    configDir = findConfigDir(options.cwd);
    if (configDir) {
      try {
        config = await loadFrontMcpConfig(configDir);
      } catch (err) {
        // Surface schema/load errors — silent fallback was the corruption
        // mode #365 worked to eliminate. The legacy-shape branch in
        // `tryLoadFrontMcpConfig` handles old configs separately.
        throw new Error(`Failed to load frontmcp.config in ${configDir}: ${(err as Error).message}`);
      }
    }
  }

  // ── Compose effective env ──
  const overlay = config?.env;
  const modeKey = modeToEnvKey(options.mode);
  const fromShared = overlay?.shared ?? {};
  const fromMode = (modeKey && overlay?.[modeKey]) ?? {};
  // Start from `process.env` so OS / CI / shell env still apply, then layer
  // shared + mode overlays + CLI-supplied env (later wins).
  const effectiveEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') effectiveEnv[key] = value;
  }
  Object.assign(effectiveEnv, fromShared, fromMode, cliEnv);

  return { config, configDir, configPath, effectiveEnv };
}
