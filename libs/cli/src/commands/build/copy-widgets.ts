/**
 * Ship FileSource widget sources with the build output (#649).
 *
 * `@frontmcp/uipack` reads a `.widget.tsx` / `.widget.jsx` file from disk and bundles
 * it with esbuild when the tool is called, at the path the tool computed — usually
 * `join(__dirname, 'queue.widget.tsx')`. tsc never emits these files (the scaffolded
 * tsconfig excludes them), so after a build `__dirname` points at a directory without
 * the widget and the call fails with ENOENT.
 *
 * The copy goes where `__dirname` points at runtime:
 * - `preserve` — tsc output that runs as emitted: every compiled tool keeps its source
 *   directory, so each widget lands at the same relative path under `outDir`.
 * - `flat` — bundled output (`<name>.bundle.js`, `handler.cjs`): every module shares the
 *   bundle's `__dirname`, so each widget lands directly in `outDir`. Two widgets with the
 *   same file name can't both be there; those are skipped and reported.
 *
 * Only the widget files are copied, not other local files a widget imports.
 */

import * as path from 'path';

import { copyFile, ensureDir, readdir, realpath, stat } from '@frontmcp/utils';

import { c } from '../../core/colors';

const WIDGET_FILE = /\.widget\.(tsx|jsx)$/;

export type WidgetCopyLayout = 'preserve' | 'flat';

export interface WidgetCopyConflict {
  /** File name shared by more than one widget. */
  name: string;
  /** The widgets with that name, relative to the source root. */
  sources: string[];
}

export interface WidgetCopyResult {
  /** Copied files, relative to `outDir`. */
  copied: string[];
  /** Names skipped in the `flat` layout because more than one widget uses them. */
  conflicts: WidgetCopyConflict[];
}

export interface CopyWidgetSourcesOptions {
  /** Directory tsc compiles from — the entry's directory, which the build emits at `outDir`. */
  srcRoot: string;
  /** Build output directory. */
  outDir: string;
  layout: WidgetCopyLayout;
}

/**
 * List the widget sources under `srcRoot`, relative to it and sorted.
 *
 * Skips `node_modules`, dot directories, and — when the output sits inside the source
 * root — the top-level directory holding `outDir`, so earlier build output is never
 * picked up as a source.
 */
export async function findWidgetSources(srcRoot: string, outDir: string): Promise<string[]> {
  const root = path.resolve(srcRoot);
  const skip = outputDirWithin(root, path.resolve(outDir));
  const visited = new Set<string>();
  const found: string[] = [];

  async function walk(dir: string): Promise<void> {
    let real: string;
    let names: string[];
    try {
      real = await realpath(dir);
      names = await readdir(dir);
    } catch {
      return;
    }
    // A symlinked directory can point back up the tree.
    if (visited.has(real)) return;
    visited.add(real);

    for (const name of [...names].sort()) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const full = path.join(dir, name);
      if (full === skip) continue;
      let info: Awaited<ReturnType<typeof stat>>;
      try {
        info = await stat(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) await walk(full);
      else if (info.isFile() && WIDGET_FILE.test(name)) found.push(path.relative(root, full));
    }
  }

  await walk(root);
  return found.sort();
}

/** Copy every widget source under `srcRoot` into `outDir` using `layout`. */
export async function copyWidgetSources(options: CopyWidgetSourcesOptions): Promise<WidgetCopyResult> {
  const srcRoot = path.resolve(options.srcRoot);
  const outDir = path.resolve(options.outDir);
  if (srcRoot === outDir) return { copied: [], conflicts: [] };

  const sources = await findWidgetSources(srcRoot, outDir);
  const plan: Array<{ from: string; to: string }> = [];
  const conflicts: WidgetCopyConflict[] = [];

  if (options.layout === 'preserve') {
    for (const rel of sources) plan.push({ from: rel, to: rel });
  } else {
    const byName = new Map<string, string[]>();
    for (const rel of sources) {
      const name = path.basename(rel);
      byName.set(name, [...(byName.get(name) ?? []), rel]);
    }
    for (const [name, rels] of byName) {
      if (rels.length > 1) conflicts.push({ name, sources: rels });
      else plan.push({ from: rels[0], to: name });
    }
    plan.sort((a, b) => a.to.localeCompare(b.to));
    conflicts.sort((a, b) => a.name.localeCompare(b.name));
  }

  for (const { from, to } of plan) {
    const dest = path.join(outDir, to);
    await ensureDir(path.dirname(dest));
    await copyFile(path.join(srcRoot, from), dest);
  }

  return { copied: plan.map((p) => p.to), conflicts };
}

/** {@link copyWidgetSources}, logging what was copied and each skipped name. */
export async function shipWidgetSources(
  options: CopyWidgetSourcesOptions & { cwd: string; label: string },
): Promise<WidgetCopyResult> {
  const result = await copyWidgetSources(options);
  const { label, cwd } = options;

  if (result.copied.length > 0) {
    const count = result.copied.length;
    console.log(
      `${c('cyan', label)} copied ${count} widget source file${count === 1 ? '' : 's'} (*.widget.tsx/jsx) to ` +
        `${path.relative(cwd, options.outDir) || '.'}`,
    );
  }
  for (const conflict of result.conflicts) {
    console.log(
      c(
        'yellow',
        `${label} not copying ${conflict.name}: ${conflict.sources.join(', ')} share the name, and every module ` +
          `in the bundle resolves __dirname to the same directory — rename them so each widget name is unique.`,
      ),
    );
  }
  return result;
}

/** The top-level directory of `outDir` inside `srcRoot`, when the output is nested in the sources. */
function outputDirWithin(srcRoot: string, outDir: string): string | undefined {
  const rel = path.relative(srcRoot, outDir);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
  return path.join(srcRoot, rel.split(path.sep)[0]);
}
