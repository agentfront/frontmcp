import { existsSync } from 'fs';
import * as path from 'path';

const TS_EXT = /\.tsx?$/;

export interface EmittedEntry {
  /** Absolute path of the compiled entry (`.js`) under `outDir`. */
  compiledEntry: string;
  /** Directory of `outDir` that mirrors the entry's own directory. */
  emittedEntryDir: string;
}

/**
 * Locate the compiled entry after `tsc` ran.
 *
 * `tsc` mirrors the sources' common root under `outDir`. When the entry imports
 * code from outside its own folder (a shared workspace lib, a path alias) that
 * common root is an ancestor of the entry's directory, so the entry lands in
 * `outDir/<relative path>/main.js` rather than `outDir/main.js`. Walk up from
 * the entry's directory (deepest first) and take the first mirrored location
 * that exists; fall back to the flat layout.
 */
export function resolveEmittedEntry(outDir: string, entry: string): EmittedEntry {
  const compiledName = path.basename(entry).replace(TS_EXT, '.js');
  const entryDir = path.dirname(entry);

  let dir = entryDir;
  for (;;) {
    const relativeDir = path.relative(dir, entryDir);
    const emittedEntryDir = path.join(outDir, relativeDir);
    const compiledEntry = path.join(emittedEntryDir, compiledName);
    if (existsSync(compiledEntry)) return { compiledEntry, emittedEntryDir };
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return { compiledEntry: path.join(outDir, compiledName), emittedEntryDir: outDir };
}
