import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { offsetFromRoot, readJson, updateJson, type Tree } from '@nx/devkit';

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

/** Major version of the workspace's TypeScript: the installed compiler first, then the declared range. */
export function getTypeScriptMajor(tree: Tree, workspaceRoot?: string): number | undefined {
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
  return Number.isFinite(major) ? major : undefined;
}

export type ProjectModuleResolution = 'bundler' | 'node10';

/**
 * `frontmcp build` compiles a project with `--module commonjs`. TypeScript 5 pairs CommonJS only with
 * `node10`; TypeScript 6 deprecates `node10` (TS5107, removed in 7) and accepts `bundler` with CommonJS.
 */
export function getModuleResolution(tree: Tree, workspaceRoot?: string): ProjectModuleResolution {
  const major = getTypeScriptMajor(tree, workspaceRoot);
  return major !== undefined && major >= 6 ? 'bundler' : 'node10';
}

function readBaseCompilerOptions(tree: Tree, workspaceRoot?: string): Record<string, unknown> {
  const basePath = join(workspaceRoot ?? '', 'tsconfig.base.json');
  if (!tree.exists(basePath)) return {};
  try {
    return readJson<{ compilerOptions?: Record<string, unknown> }>(tree, basePath).compilerOptions ?? {};
  } catch {
    return {};
  }
}

export interface ProjectTsOptions {
  moduleResolution: ProjectModuleResolution;
  /**
   * Nx TS-solution workspaces set `customConditions` in `tsconfig.base.json`, which `node10` rejects
   * (TS5098). A project resolving with `node10` then has to reset it.
   */
  resetCustomConditions: boolean;
}

/** Compiler options a FrontMCP project's `tsconfig.json` sets so it builds in any workspace. */
export function getProjectTsOptions(tree: Tree, workspaceRoot?: string): ProjectTsOptions {
  const moduleResolution = getModuleResolution(tree, workspaceRoot);
  const base = readBaseCompilerOptions(tree, workspaceRoot);
  return {
    moduleResolution,
    resetCustomConditions: moduleResolution === 'node10' && base['customConditions'] !== undefined,
  };
}

/**
 * Register a `paths` alias in `tsconfig.base.json` (when the workspace has one). The target is written
 * relative (`./libs/x/src/index.ts`): without a `baseUrl` — Nx TS-solution workspaces, TypeScript 6 —
 * a bare `libs/...` target is an error (TS5090), and with `baseUrl: "."` both spellings resolve alike.
 */
export function addTsPathAlias(
  tree: Tree,
  alias: string,
  target: string,
  options: { overwrite?: boolean } = {},
): void {
  if (!tree.exists('tsconfig.base.json')) return;
  const relativeTarget = target.startsWith('./') || target.startsWith('../') ? target : `./${target}`;
  updateJson(tree, 'tsconfig.base.json', (json: { compilerOptions?: { paths?: Record<string, string[]> } }) => {
    const compilerOptions = json.compilerOptions ?? {};
    const paths = compilerOptions.paths ?? {};
    if (options.overwrite !== false || !paths[alias]) {
      paths[alias] = [relativeTarget];
    }
    compilerOptions.paths = paths;
    json.compilerOptions = compilerOptions;
    return json;
  });
}
