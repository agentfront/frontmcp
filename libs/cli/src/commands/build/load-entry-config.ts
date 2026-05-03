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
  const prev = process.env['FRONTMCP_SCHEMA_EXTRACT'];
  process.env['FRONTMCP_SCHEMA_EXTRACT'] = '1';
  try {
    // Path 1: plain require() — works for compiled JS entries.
    try {
      const mod = require(entry) as { default?: unknown } & Record<string, unknown>;
      const target = mod.default ?? mod;
      const config = readDecoratorMetadata(target);
      if (config) return config;
    } catch {
      // require failed (e.g., .ts entry without a hook); fall through to esbuild.
    }

    // Path 2: esbuild transpile + Module._compile, only if the entry is .ts/.tsx.
    if (/\.tsx?$/i.test(entry)) {
      try {
        return await loadTsEntryViaEsbuild(entry);
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
  return undefined;
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
