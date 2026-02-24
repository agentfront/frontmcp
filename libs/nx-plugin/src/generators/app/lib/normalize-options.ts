import { names, joinPathFragments } from '@nx/devkit';
import type { AppGeneratorSchema } from '../schema.js';

export interface NormalizedAppOptions {
  name: string;
  projectName: string;
  projectRoot: string;
  className: string;
  fileName: string;
  propertyName: string;
  parsedTags: string[];
  skipFormat: boolean;
}

export function normalizeOptions(schema: AppGeneratorSchema): NormalizedAppOptions {
  const { className, fileName, propertyName } = names(schema.name);
  const projectRoot = schema.directory ?? joinPathFragments('apps', fileName);
  const parsedTags = schema.tags ? schema.tags.split(',').map((t) => t.trim()) : ['scope:apps'];

  return {
    name: schema.name,
    projectName: fileName,
    projectRoot,
    className,
    fileName,
    propertyName,
    parsedTags,
    skipFormat: schema.skipFormat ?? false,
  };
}
