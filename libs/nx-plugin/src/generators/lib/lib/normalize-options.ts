import { type Tree, names, joinPathFragments, readJson } from '@nx/devkit';
import type { LibGeneratorSchema } from '../schema.js';
import { getProjectTsOptions, resolveProjectPaths, type ProjectModuleResolution } from '../../../utils/project-paths.js';

export interface NormalizedLibOptions {
  name: string;
  projectName: string;
  projectRoot: string;
  offset: string;
  moduleResolution: ProjectModuleResolution;
  resetCustomConditions: boolean;
  className: string;
  fileName: string;
  propertyName: string;
  libType: 'generic' | 'plugin' | 'adapter' | 'tool-register';
  publishable: boolean;
  importPath: string;
  parsedTags: string[];
  skipFormat: boolean;
}

interface WorkspaceManifest {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readWorkspaceManifest(tree: Tree): WorkspaceManifest {
  return tree.exists('package.json') ? readJson<WorkspaceManifest>(tree, 'package.json') : {};
}

/** The workspace's own npm scope (`@acme/source` → `@acme/<name>`), else the bare name. */
function defaultImportPath(workspace: WorkspaceManifest, fileName: string): string {
  const scope = /^(@[^/]+)\//.exec(workspace.name ?? '')?.[1];
  return scope ? `${scope}/${fileName}` : fileName;
}

/** A `paths` key that resolves the import path: the exact key, else a single-`*` wildcard key, as TypeScript matches them. */
function findMappingKey(paths: Record<string, string[]>, importPath: string): string | undefined {
  if (paths[importPath]) return importPath;
  return Object.keys(paths).find((key) => {
    const [prefix, suffix, ...rest] = key.split('*');
    return (
      suffix !== undefined &&
      rest.length === 0 &&
      importPath.length >= prefix.length + suffix.length &&
      importPath.startsWith(prefix) &&
      importPath.endsWith(suffix)
    );
  });
}

/** Refuse an import path that would point an existing alias or an installed package at the new library. */
function assertImportPathIsFree(tree: Tree, workspace: WorkspaceManifest, importPath: string): void {
  const paths = tree.exists('tsconfig.base.json')
    ? (readJson<{ compilerOptions?: { paths?: Record<string, string[]> } }>(tree, 'tsconfig.base.json').compilerOptions
        ?.paths ?? {})
    : {};
  const mappingKey = findMappingKey(paths, importPath);
  if (mappingKey) {
    const via = mappingKey === importPath ? '' : ` by "${mappingKey}"`;
    throw new Error(
      `The import path "${importPath}" is already mapped in tsconfig.base.json${via} to ${paths[mappingKey].join(', ')}. Pass --importPath with another name.`,
    );
  }
  if (workspace.dependencies?.[importPath] ?? workspace.devDependencies?.[importPath]) {
    throw new Error(
      `The import path "${importPath}" is a package this workspace depends on; the library would shadow it. Pass --importPath with another name.`,
    );
  }
}

export function normalizeOptions(tree: Tree, schema: LibGeneratorSchema): NormalizedLibOptions {
  const { className, fileName, propertyName } = names(schema.name);
  const { projectRoot, offset } = resolveProjectPaths(schema.directory ?? joinPathFragments('libs', fileName));
  const libType = schema.libType ?? 'generic';
  const publishable = schema.publishable ?? false;
  const workspace = readWorkspaceManifest(tree);
  const importPath = schema.importPath ?? defaultImportPath(workspace, fileName);
  assertImportPathIsFree(tree, workspace, importPath);
  const parsedTags = schema.tags
    ? schema.tags.split(',').map((t) => t.trim())
    : ['scope:libs'];

  if (publishable) {
    parsedTags.push('scope:publishable');
  }

  return {
    name: schema.name,
    projectName: fileName,
    projectRoot,
    offset,
    ...getProjectTsOptions(tree),
    className,
    fileName,
    propertyName,
    libType,
    publishable,
    importPath,
    parsedTags,
    skipFormat: schema.skipFormat ?? false,
  };
}
