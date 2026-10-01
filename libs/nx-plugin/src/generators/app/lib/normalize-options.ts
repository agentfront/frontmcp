import { type Tree, names, joinPathFragments } from '@nx/devkit';
import type { AppGeneratorSchema } from '../schema.js';
import { getProjectTsOptions, resolveProjectPaths, type ProjectModuleResolution } from '../../../utils/project-paths.js';

export interface NormalizedAppOptions {
  name: string;
  projectName: string;
  /** Project root relative to the Nx workspace root. */
  projectRoot: string;
  /** Where the files are written, relative to the tree root. */
  outputRoot: string;
  /** Path from the project back to the workspace root, e.g. `../../`. */
  offset: string;
  moduleResolution: ProjectModuleResolution;
  resetCustomConditions: boolean;
  className: string;
  fileName: string;
  propertyName: string;
  parsedTags: string[];
  skipFormat: boolean;
}

export function normalizeOptions(tree: Tree, schema: AppGeneratorSchema): NormalizedAppOptions {
  const { className, fileName, propertyName } = names(schema.name);
  const outputRoot = schema.directory ?? joinPathFragments(schema.workspaceRoot ?? '', 'apps', fileName);
  const { projectRoot, offset } = resolveProjectPaths(outputRoot, schema.workspaceRoot);
  const parsedTags = schema.tags ? schema.tags.split(',').map((t) => t.trim()) : ['scope:apps'];

  return {
    name: schema.name,
    projectName: fileName,
    projectRoot,
    outputRoot,
    offset,
    ...getProjectTsOptions(tree, schema.workspaceRoot),
    className,
    fileName,
    propertyName,
    parsedTags,
    skipFormat: schema.skipFormat ?? false,
  };
}
