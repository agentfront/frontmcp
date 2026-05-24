/**
 * Default-path resolver for the top-level `sqlite` block (issue #401).
 *
 * Policy:
 *  - **dev + node + non-CLI**: `<projectRoot>/dist/sessions.sqlite` —
 *    keeps dev data under the project tree so multiple frontmcp apps in
 *    different repos don't share the same database.
 *  - **prod OR CLI mode**: `~/.{appName}/sessions.sqlite` — per-app
 *    namespace under the user's home directory. Multiple installed
 *    frontmcp apps therefore get isolated databases. Falls back to
 *    `~/.frontmcp/` when `info.name` is missing or unsanitizable.
 *  - **edge / non-node runtimes**: never apply a default path; callers
 *    must surface the existing edge-runtime error (better-sqlite3 is a
 *    native module and won't load there).
 *
 * The resolver is pure — it returns a string. Filesystem side-effects
 * (mkdir on the parent dir) happen in the caller after the path is
 * resolved so this module stays unit-testable without a real disk.
 */

import { homedir } from 'os';
import * as path from 'path';

import { getRuntimeContext, readFileSync } from '@frontmcp/utils';

export interface SqlitePathResolverContext {
  /** Server name from `@FrontMcp({ info: { name } })`. */
  appName?: string;
  /** True when the SDK is running under the `frontmcp` CLI. */
  cliMode: boolean;
  /** Override for process.cwd() (used by tests). */
  cwd?: string;
}

export function resolveDefaultSqlitePath(ctx: SqlitePathResolverContext): string {
  const cwd = ctx.cwd ?? process.cwd();
  const { env, runtime } = getRuntimeContext();
  const namespace = sanitizeForFs(ctx.appName) || 'frontmcp';

  // CLI mode OR production: home dir, per-app namespace
  if (ctx.cliMode || env === 'production') {
    return path.join(homedir(), `.${namespace}`, 'sessions.sqlite');
  }

  // Non-node runtimes can't load better-sqlite3 anyway; the resolver still
  // returns a sensible string so log messages aren't broken. The actual
  // error surfaces in the storage-sqlite require() at runtime.
  if (runtime !== 'node') {
    return path.join(homedir(), `.${namespace}`, 'sessions.sqlite');
  }

  // dev + node: project build folder
  const projectRoot = findProjectRoot(cwd) ?? cwd;
  return path.join(projectRoot, 'dist', 'sessions.sqlite');
}

function sanitizeForFs(name: string | undefined): string {
  if (!name) return '';
  return name.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^[-.]+/, '');
}

function findProjectRoot(start: string): string | undefined {
  let dir = start;
  // Cap the walk at 32 levels to bound worst-case (sandbox / symlink loops).
  // `@frontmcp/utils.readFileSync` is the sync FS escape hatch per the
  // SDK-boundary rule (no direct `fs.existsSync`). A read attempt is a
  // strictly stronger probe than `existsSync` — a missing file throws
  // ENOENT, which we treat as "not here, keep walking".
  for (let i = 0; i < 32; i++) {
    try {
      readFileSync(path.join(dir, 'package.json'));
      return dir;
    } catch {
      // package.json absent at this level — fall through to parent.
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}
