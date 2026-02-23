import { names, joinPathFragments } from '@nx/devkit';
import type { ServerGeneratorSchema } from '../schema.js';

export interface NormalizedServerOptions {
  name: string;
  projectName: string;
  projectRoot: string;
  className: string;
  fileName: string;
  deploymentTarget: 'node' | 'vercel' | 'lambda' | 'cloudflare';
  appNames: string[];
  redis: 'docker' | 'existing' | 'none';
  parsedTags: string[];
  skipFormat: boolean;
}

export function normalizeOptions(schema: ServerGeneratorSchema): NormalizedServerOptions {
  const { className, fileName } = names(schema.name);
  const projectRoot = schema.directory ?? joinPathFragments('servers', fileName);
  const parsedTags = schema.tags
    ? schema.tags.split(',').map((t) => t.trim())
    : ['scope:servers'];

  const appNames = schema.apps.split(',').map((a) => a.trim()).filter(Boolean);

  return {
    name: schema.name,
    projectName: `server-${fileName}`,
    projectRoot,
    className,
    fileName,
    deploymentTarget: schema.deploymentTarget ?? 'node',
    appNames,
    redis: schema.redis ?? 'none',
    parsedTags,
    skipFormat: schema.skipFormat ?? false,
  };
}
