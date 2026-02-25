import { names, joinPathFragments } from '@nx/devkit';
import type { LibGeneratorSchema } from '../schema.js';

export interface NormalizedLibOptions {
  name: string;
  projectName: string;
  projectRoot: string;
  className: string;
  fileName: string;
  propertyName: string;
  libType: 'generic' | 'plugin' | 'adapter' | 'tool-register';
  publishable: boolean;
  importPath: string;
  parsedTags: string[];
  skipFormat: boolean;
}

export function normalizeOptions(schema: LibGeneratorSchema): NormalizedLibOptions {
  const { className, fileName, propertyName } = names(schema.name);
  const projectRoot = schema.directory ?? joinPathFragments('libs', fileName);
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
