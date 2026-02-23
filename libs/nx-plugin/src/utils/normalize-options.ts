import { type Tree, getProjects, joinPathFragments } from '@nx/devkit';
import { toFileName } from './names.js';

export interface NormalizedPrimitiveOptions {
  name: string;
  project: string;
  projectRoot: string;
  projectSourceRoot: string;
  fileName: string;
  className: string;
  directory: string;
}

export interface PrimitiveSchemaBase {
  name: string;
  project: string;
  directory?: string;
}

export function normalizePrimitiveOptions(
  tree: Tree,
  schema: PrimitiveSchemaBase,
  subdirectory: string,
): NormalizedPrimitiveOptions {
  const projects = getProjects(tree);
  const projectConfig = projects.get(schema.project);
  if (!projectConfig) {
    throw new Error(`Project "${schema.project}" not found in the workspace.`);
  }

  const projectRoot = projectConfig.root;
  const projectSourceRoot = projectConfig.sourceRoot ?? joinPathFragments(projectRoot, 'src');
  const fileName = toFileName(schema.name);

  const { names } = require('@nx/devkit') as typeof import('@nx/devkit');
  const className = names(schema.name).className;

  const directory = schema.directory
    ? joinPathFragments(projectSourceRoot, subdirectory, schema.directory)
    : joinPathFragments(projectSourceRoot, subdirectory);

  return {
    name: schema.name,
    project: schema.project,
    projectRoot,
    projectSourceRoot,
    fileName,
    className,
    directory,
  };
}
