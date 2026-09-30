import { join } from 'path';

import { formatFiles, generateFiles, type GeneratorCallback, type Tree } from '@nx/devkit';

import { normalizeOptions } from './lib/index.js';
import type { AppGeneratorSchema } from './schema.js';

export async function appGenerator(tree: Tree, schema: AppGeneratorSchema): Promise<GeneratorCallback | void> {
  return appGeneratorInternal(tree, schema);
}

async function appGeneratorInternal(tree: Tree, schema: AppGeneratorSchema): Promise<GeneratorCallback | void> {
  const options = normalizeOptions(tree, schema);

  generateFiles(tree, join(__dirname, 'files'), options.outputRoot, {
    ...options,
    tmpl: '',
  });

  if (!options.skipFormat) {
    await formatFiles(tree);
  }
}

export default appGenerator;
