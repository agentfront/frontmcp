/**
 * Best-effort load of a user's `@FrontMcp()`-decorated entry to read its
 * decorator config at build time.
 *
 * Why it exists: `runAdapterBuild` and the adapter `validate` hook need
 * `@FrontMcp({ http, sqlite, redis })` *before* TypeScript compilation runs,
 * but the entry itself is usually `./src/main.ts` — `require()` can't load it
 * without a TS hook. Falling back to esbuild + `Module._compile` lets us
 * read the metadata regardless of whether the entry is `.ts` or `.js`.
 *
 * Returns `undefined` when the entry can't be loaded or doesn't carry a
 * decorator config (plain config object, missing decorator, etc.). Callers
 * should treat that as "no metadata available" and not as a build failure.
 */
import * as fs from 'fs';
import * as path from 'path';

const FRONTMCP_CONFIG_METADATA_KEY = '__frontmcp:config';

/**
 * Result returned alongside the runtime-evaluated decorator config. The
 * `keysSeenInSource` field carries top-level identifiers found in the
 * `@FrontMcp({...})` arg expression even when those keys' values are
 * conditional or env-gated — a `validate` hook can use it to fail loud
 * on `sqlite: process.env.X ? {...} : undefined` patterns that the
 * runtime config object alone can't catch (#375 round-2).
 */
export interface EntryDecoratorInfo {
  /** Best-effort runtime config object (when the decorator was evaluated). */
  decoratorConfig: Record<string, unknown> | undefined;
  /**
   * Top-level property names that appear in `@FrontMcp({...})` argument
   * expressions in the entry source — regardless of whether they're literals,
   * ternaries, function calls, or env-gated branches. Used by adapter
   * validators to reject runtime-incompatible options before bundling.
   */
  keysSeenInSource: string[];
}

interface ReflectLike {
  getMetadata?: (key: string, target: unknown) => unknown;
}

function readDecoratorMetadata(target: unknown): Record<string, unknown> | undefined {
  if (typeof target !== 'function') {
    if (target && typeof target === 'object') {
      // Plain config object — return as-is so the validate() can inspect
      // top-level fields like `sqlite`, `redis`, `http` directly.
      return target as Record<string, unknown>;
    }
    return undefined;
  }
  const reflect = (globalThis as { Reflect?: ReflectLike }).Reflect;
  if (!reflect?.getMetadata) return undefined;
  const config = reflect.getMetadata(FRONTMCP_CONFIG_METADATA_KEY, target);
  return (config ?? undefined) as Record<string, unknown> | undefined;
}

/**
 * Load the entry, extract its `@FrontMcp` decorator config, and return it.
 * Falls back to esbuild for TS entries.
 */
export async function loadEntryDecoratorConfig(entry: string): Promise<Record<string, unknown> | undefined> {
  const info = await loadEntryDecoratorInfo(entry);
  return info.decoratorConfig;
}

/**
 * Round-2 (#375): same as `loadEntryDecoratorConfig` but also returns the
 * set of top-level property names found in any `@FrontMcp({...})` argument
 * expression in the entry source. This catches conditional-config patterns
 * like `sqlite: process.env.X ? {...} : undefined` where the runtime config
 * object's `sqlite` key may evaluate to `undefined` at decorator-construction
 * time but the bundled output still ships a Node-only branch.
 */
export async function loadEntryDecoratorInfo(entry: string): Promise<EntryDecoratorInfo> {
  const prev = process.env['FRONTMCP_SCHEMA_EXTRACT'];
  process.env['FRONTMCP_SCHEMA_EXTRACT'] = '1';
  let decoratorConfig: Record<string, unknown> | undefined;
  try {
    // Path 1: plain require() — works for compiled JS entries.
    try {
      const mod = require(entry) as { default?: unknown } & Record<string, unknown>;
      const target = mod.default ?? mod;
      decoratorConfig = readDecoratorMetadata(target);
    } catch {
      // require failed (e.g., .ts entry without a hook); fall through to esbuild.
    }

    // Path 2: esbuild transpile + Module._compile, only if the entry is .ts/.tsx.
    if (!decoratorConfig && /\.tsx?$/i.test(entry)) {
      try {
        decoratorConfig = await loadTsEntryViaEsbuild(entry);
      } catch {
        // Anything throws (esbuild parse error, runtime error in the entry, etc.) —
        // return undefined so the caller's validate() falls back to a no-op
        // and the regular tsc compile produces the real error message.
      }
    }
  } finally {
    if (prev === undefined) delete process.env['FRONTMCP_SCHEMA_EXTRACT'];
    else process.env['FRONTMCP_SCHEMA_EXTRACT'] = prev;
  }

  // Source-level scan runs unconditionally (in addition to the runtime
  // load) because the runtime path can't see env-gated branches.
  const keysSeenInSource = scanFrontMcpDecoratorKeys(entry);
  return { decoratorConfig, keysSeenInSource };
}

/**
 * Read the entry source and collect property names that appear at the top
 * level of any `@FrontMcp({...})` argument expression — regardless of whether
 * the value is a literal, ternary, env-gated, or function call.
 *
 * Approach: locate `@FrontMcp(`, find the matching `)`, walk that slice
 * tracking brace/paren depth, and at depth==1 inside a `{ ... }` collect
 * `<key>:` identifiers. Comments and strings are stripped first so a literal
 * `// sqlite: { ... }` or a `'sqlite:'` string don't false-positive. Failures
 * (no decorator found, syntax we can't parse) return an empty list — never
 * throws, since this is a best-effort safety net layered on top of runtime
 * validation.
 */
function scanFrontMcpDecoratorKeys(entry: string): string[] {
  let source: string;
  try {
    source = fs.readFileSync(entry, 'utf-8');
  } catch {
    return [];
  }
  // Strip block comments, line comments, and string literals so we don't
  // false-match on them.
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, '``');

  const decoratorIdx = stripped.indexOf('@FrontMcp(');
  if (decoratorIdx === -1) return [];

  // Find the argument body that starts at the first `{` after `@FrontMcp(`.
  let i = decoratorIdx + '@FrontMcp('.length;
  while (i < stripped.length && stripped[i] !== '{') {
    if (stripped[i] === ')') return []; // empty/no-object arg
    i++;
  }
  if (stripped[i] !== '{') return [];

  // Walk the object literal, collecting top-level keys. Depth-1 = the
  // outer `{ ... }`; deeper braces (nested object literals, ternary
  // branches, function bodies) are skipped.
  const keys = new Set<string>();
  let depth = 0;
  let parenDepth = 0;
  // Detect property keys: an identifier (letters/_/$) followed by `:` at depth==1.
  const keyRe = /[A-Za-z_$][A-Za-z0-9_$]*/y;
  while (i < stripped.length) {
    const ch = stripped[i];
    if (ch === '{') {
      depth++;
      i++;
      continue;
    }
    if (ch === '}') {
      depth--;
      i++;
      if (depth === 0 && parenDepth === 0) break;
      continue;
    }
    if (ch === '(') {
      parenDepth++;
      i++;
      continue;
    }
    if (ch === ')') {
      parenDepth--;
      i++;
      if (depth === 0 && parenDepth < 0) break;
      continue;
    }
    if (depth === 1 && parenDepth === 0 && /[A-Za-z_$]/.test(ch)) {
      keyRe.lastIndex = i;
      const m = keyRe.exec(stripped);
      if (m) {
        const after = m.index + m[0].length;
        // Skip whitespace, then expect ':'. (`?:` for optional spacing.)
        let j = after;
        while (j < stripped.length && /\s/.test(stripped[j])) j++;
        if (stripped[j] === ':') {
          keys.add(m[0]);
        }
        i = after;
        continue;
      }
    }
    i++;
  }
  return Array.from(keys);
}

async function loadTsEntryViaEsbuild(entryPath: string): Promise<Record<string, unknown> | undefined> {
  const esbuild = require('esbuild') as typeof import('esbuild');
  const source = fs.readFileSync(entryPath, 'utf-8');
  const transformed = esbuild.transformSync(source, {
    loader: 'ts',
    format: 'cjs',
    target: 'es2022',
    sourcefile: entryPath,
  });

  const Module = require('module') as typeof import('module');
  const m = new Module(entryPath, module);
  m.filename = entryPath;
  // Resolve user `import { ... } from '@frontmcp/sdk'` against the user's
  // node_modules, not the CLI's. Same trick as the config loader.
  m.paths = (Module as unknown as { _nodeModulePaths(p: string): string[] })._nodeModulePaths(
    path.dirname(entryPath),
  );
   
  (m as any)._compile(transformed.code, entryPath);
   
  const exported = (m as any).exports as { default?: unknown } & Record<string, unknown>;
  const target = exported.default ?? exported;
  return readDecoratorMetadata(target);
}
