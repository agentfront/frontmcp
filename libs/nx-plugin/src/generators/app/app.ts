import { type Tree, formatFiles, generateFiles, type GeneratorCallback } from '@nx/devkit';
import { join } from 'path';
import type { AppGeneratorSchema } from './schema.js';
import { normalizeOptions } from './lib/index.js';

export async function appGenerator(tree: Tree, schema: AppGeneratorSchema): Promise<GeneratorCallback | void> {
  return appGeneratorInternal(tree, schema);
}

async function appGeneratorInternal(tree: Tree, schema: AppGeneratorSchema): Promise<GeneratorCallback | void> {
  const options = normalizeOptions(schema);

  generateFiles(tree, join(__dirname, 'files'), options.projectRoot, {
    ...options,
    tmpl: '',
  });

  if (!options.skipFormat) {
    await formatFiles(tree);
  }
}

export default appGenerator;
