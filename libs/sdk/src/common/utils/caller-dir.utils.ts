// common/utils/caller-dir.utils.ts
//
// Shared "which source file declared this?" helper. Decorator FACTORIES
// (`@Skill`, `@FrontMcp`, `@App`) call this at evaluation time — i.e. while the
// user's source file is still on the call stack — to capture the directory of
// the user's defining module. That directory then anchors relative file paths
// (skill `instructions: { file }`, `auth.ui[slot]`, …) so they resolve against
// the file that declared them rather than `process.cwd()` (issue #444).
//
// This generalizes the original `parseCallerDir` that lived in
// `skill.decorator.ts`: the skip-list is now a parameter so each caller can
// exclude its own decorator file (by basename) on top of the always-skipped
// framework frames (node internals, `node_modules`, `@frontmcp/`, `/dist/`).

import { basename, dirname } from '@frontmcp/utils';

/**
 * Frame-substring patterns that are ALWAYS skipped because they are framework
 * or third-party code, never the user's defining module:
 *  - `node:` — Node internal modules.
 *  - `node_modules` — any installed dependency.
 *  - `@frontmcp/` — a published FrontMCP package (its dist lands under
 *    `node_modules/@frontmcp/...`, but a monorepo `tsx` run resolves it via the
 *    source path which still contains this segment).
 *  - `/dist/` and `\dist\` — compiled framework output.
 */
const ALWAYS_SKIP: readonly string[] = ['node:', 'node_modules', '@frontmcp/', '/dist/', '\\dist\\'];

/**
 * Capture the directory of the first user-code frame on the current call stack.
 *
 * Returns `undefined` when no user frame can be determined (e.g. an exotic
 * loader strips stack frames, or the runtime has no V8-style stack) — callers
 * fall back to `process.cwd()`.
 *
 * @param skipBasenames - Additional file basenames to skip (e.g. the caller's
 *   own decorator file `front-mcp.decorator.ts` / `.js`), so the FIRST returned
 *   frame is the user's module, not the framework's wrapper. Matched by
 *   basename only (POSIX + Windows), so `foo.decorator.spec.ts` is NOT skipped
 *   when `foo.decorator.ts` is.
 */
export function captureCallerDir(skipBasenames: readonly string[] = []): string | undefined {
  return parseCallerDir(new Error().stack, skipBasenames);
}

/**
 * Pure parser for a V8-format stack string: returns the directory of the first
 * frame that is NOT framework code (per {@link ALWAYS_SKIP}) and not one of
 * `skipBasenames`. Exported for unit testing — the production entry point is
 * {@link captureCallerDir}.
 *
 * Supports both CJS frames (`at fn (/abs/foo.ts:1:1)`) and ESM frames
 * (`at fn (file:///abs/foo.ts:1:1)`); ESM `file://` URLs are converted via
 * `node:url`'s `fileURLToPath` so the result is a usable filesystem path on
 * both POSIX and Windows.
 *
 * @internal
 */
export function parseCallerDir(stack: string | undefined, skipBasenames: readonly string[] = []): string | undefined {
  if (!stack) return undefined;

  const lines = stack.split('\n');
  // Start from index 1 (skip the "Error" header line); cap at 30 frames.
  for (let i = 1; i < lines.length && i < 30; i++) {
    const line = lines[i];
    // Cap per-line length so the greedy regexes below can never backtrack
    // pathologically on a hostile / malformed stack (CodeQL ReDoS finding from
    // the original parseCallerDir — GHAS 146/147). A real frame is well under
    // this; anything longer is almost certainly not a real frame.
    if (line.length > 2048) continue;
    // Match "at func (...:line:col)" and "at ...:line:col"; the capture group
    // greedily includes a `file://` scheme when present.
    const match = line.match(/\(([^)]+):\d+:\d+\)/) || line.match(/at\s+([^\s]+):\d+:\d+/);
    if (!match) continue;

    let file = match[1];

    // ESM frames surface URLs; convert to a filesystem path before dirname().
    if (file.startsWith('file://')) {
      try {
        // Lazy-require so browser/Edge builds that never import `node:url` stay clean.

        const { fileURLToPath } = require('node:url');
        file = fileURLToPath(file);
      } catch {
        // node:url unavailable (browser-ish runtimes) — best-effort strip.
        file = file.replace(/^file:\/\//, '');
      }
    }

    if (file.startsWith('node:')) continue;
    if (ALWAYS_SKIP.some((p) => file.includes(p))) continue;

    // `basename` from `@frontmcp/utils` handles POSIX + Windows separators and
    // is not a regex — sidesteps the CodeQL ReDoS warning the old `[^/\\]+$`
    // regex tripped (GHAS #147).
    const base = basename(file);
    // Always skip THIS helper file (it sits between the decorator factory and
    // the user frame on the live stack) plus the caller-supplied basenames.
    if (base === 'caller-dir.utils.ts' || base === 'caller-dir.utils.js') continue;
    if (skipBasenames.includes(base)) continue;

    return dirname(file);
  }
  return undefined;
}
