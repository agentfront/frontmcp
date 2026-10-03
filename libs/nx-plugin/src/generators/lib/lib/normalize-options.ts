import { type Tree, names, joinPathFragments } from '@nx/devkit';
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

export function normalizeOptions(tree: Tree, schema: LibGeneratorSchema): NormalizedLibOptions {
  const { className, fileName, propertyName } = names(schema.name);
  const { projectRoot, offset } = resolveProjectPaths(schema.directory ?? joinPathFragments('libs', fileName));
  const libType = schema.libType ?? 'generic';
  const publishable = schema.publishable ?? false;
  const importPath = schema.importPath ?? `@frontmcp/${fileName}`;
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
