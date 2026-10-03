/**
 * Project root for commands that find `frontmcp.config.*` above the cwd (#679).
 *
 * `resolveConfig` walks up from the cwd to the nearest `frontmcp.config.*`, so
 * `frontmcp build` / `frontmcp dev` work from a subfolder — but every path in
 * that file (`entry`, `deployments[].outDir`) and every project file the
 * command reads (`tsconfig.json`, `package.json`, `.env`) is relative to the
 * folder holding the config, not to where the command was typed. Resolving them
 * from the cwd made `frontmcp build` in `src/` fail with
 * `Entry override not found: ./src/main.ts` (and clean `src/dist/`).
 *
 * The fix is the one npm and cargo use: when the config was found by the
 * upward search, the command runs from the config's folder. Paths given on the
 * command line still mean what the user typed — they are made absolute against
 * the invocation directory before the switch.
 *
 * An explicit `--config <path>` / `FRONTMCP_CONFIG` does not move the command:
 * the user chose both the file and the directory they run from.
 */

import * as path from 'path';

import type { ResolvedFrontMcpConfig } from './frontmcp-config.resolve';

/**
 * Switch to the directory holding a searched-for `frontmcp.config.*` when it is
 * not the cwd. Returns the directory the command now runs from.
 */
export function enterConfigRoot(
  resolved: Pick<ResolvedFrontMcpConfig, 'configDir' | 'configSource'>,
  invocationCwd: string,
  chdir: (dir: string) => void = (dir) => process.chdir(dir),
): string {
  if (resolved.configSource !== 'search' || !resolved.configDir) return invocationCwd;
  const root = path.resolve(resolved.configDir);
  if (root === path.resolve(invocationCwd)) return invocationCwd;
  chdir(root);
  return root;
}

/**
 * Return a copy of `opts` with the named path options made absolute against
 * `from` (the directory the user typed the command in). Unset and non-string
 * values are left alone.
 */
export function absolutizePathOptions<T extends object>(opts: T, keys: ReadonlyArray<keyof T>, from: string): T {
  const next = { ...opts };
  for (const key of keys) {
    const value = next[key];
    if (typeof value === 'string' && value.length > 0) {
      next[key] = path.resolve(from, value) as T[keyof T];
    }
  }
  return next;
}
