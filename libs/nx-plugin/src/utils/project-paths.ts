import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { offsetFromRoot, type Tree } from '@nx/devkit';

export interface ProjectPaths {
  /** Project root relative to the Nx workspace root (what project.json must contain). */
  projectRoot: string;
  /** Relative path from the project root back to the workspace root, with a trailing slash. */
  offset: string;
}

function normalizeDirectory(value: string): string {
  let result = value.replace(/\\/g, '/');
  if (result.startsWith('./')) result = result.slice(2);
  let end = result.length;
  while (end > 0 && result[end - 1] === '/') end--;
  return result.slice(0, end);
}

/**
 * `directory` is relative to the tree root. When the tree root sits above the
 * workspace (the `workspace` generator scaffolds into `<name>/`), pass that
 * folder as `workspaceRoot` so the paths written into project files are
 * relative to the workspace itself.
 */
export function resolveProjectPaths(directory: string, workspaceRoot?: string): ProjectPaths {
  const normalized = normalizeDirectory(directory);
  const base = normalizeDirectory(workspaceRoot ?? '');
  const projectRoot = base && normalized.startsWith(`${base}/`) ? normalized.slice(base.length + 1) : normalized;
  return { projectRoot, offset: offsetFromRoot(projectRoot) };
}

/**
 * TypeScript 6 rejects the classic `node10` module resolution unless the
 * deprecation is acknowledged, but older compilers reject the acknowledgement
 * itself, so it is only emitted when the workspace really runs TypeScript 6+.
 */
export function getIgnoreDeprecations(tree: Tree, workspaceRoot?: string): string {
  const root = workspaceRoot ?? '';
  const installed = join(tree.root, root, 'node_modules', 'typescript', 'package.json');
  let range: string | undefined;
  try {
    if (existsSync(installed)) {
      range = (JSON.parse(readFileSync(installed, 'utf8')) as { version?: string }).version;
    }
  } catch {
    range = undefined;
  }
  if (!range) {
    const pkgPath = join(root, 'package.json');
    if (tree.exists(pkgPath)) {
      const pkg = JSON.parse(tree.read(pkgPath, 'utf-8') ?? '{}') as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      range = pkg.devDependencies?.['typescript'] ?? pkg.dependencies?.['typescript'];
    }
  }
  const major = Number(range?.match(/\d+/)?.[0]);
  return Number.isFinite(major) && major >= 6 ? '6.0' : '';
}
