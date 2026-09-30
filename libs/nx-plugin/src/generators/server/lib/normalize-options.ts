import { type Tree, getProjects, joinPathFragments, names } from '@nx/devkit';
import { posix } from 'path';
import type { ServerGeneratorSchema } from '../schema.js';
import { getIgnoreDeprecations, resolveProjectPaths } from '../../../utils/project-paths.js';

export interface NormalizedServerOptions {
  name: string;
  projectName: string;
  projectRoot: string;
  offset: string;
  ignoreDeprecations: string;
  className: string;
  fileName: string;
  deploymentTarget: 'node' | 'vercel' | 'lambda' | 'cloudflare';
  appNames: string[];
  /** Each composed app with the import specifier `main.ts` uses, relative to the server's `src/`. */
  appImports: Array<{ className: string; importPath: string }>;
  redis: 'docker' | 'existing' | 'none';
  parsedTags: string[];
  skipFormat: boolean;
}

export function normalizeOptions(tree: Tree, schema: ServerGeneratorSchema): NormalizedServerOptions {
  const { className, fileName } = names(schema.name);
  const { projectRoot, offset } = resolveProjectPaths(schema.directory ?? joinPathFragments('servers', fileName));
  const parsedTags = schema.tags
    ? schema.tags.split(',').map((t) => t.trim())
    : ['scope:servers'];

  const appNames = schema.apps.split(',').map((a) => a.trim()).filter(Boolean);

  const projects = getProjects(tree);
  const appImports = appNames.map((appName) => {
    const { className: appClass, fileName: appFile } = names(appName);
    const appProject = projects.get(appName) ?? projects.get(appFile);
    const appSourceRoot = appProject?.sourceRoot ?? joinPathFragments(appProject?.root ?? joinPathFragments('apps', appFile), 'src');
    const importPath = posix.relative(joinPathFragments(projectRoot, 'src'), joinPathFragments(appSourceRoot, `${appFile}.app`));
    return { className: `${appClass}App`, importPath: importPath.startsWith('.') ? importPath : `./${importPath}` };
  });

  return {
    name: schema.name,
    projectName: `server-${fileName}`,
    projectRoot,
    offset,
    ignoreDeprecations: getIgnoreDeprecations(tree),
    className,
    fileName,
    deploymentTarget: schema.deploymentTarget ?? 'node',
    appNames,
    appImports,
    redis: schema.redis ?? 'none',
    parsedTags,
    skipFormat: schema.skipFormat ?? false,
  };
}
