import { join } from 'path';

import { formatFiles, generateFiles, type GeneratorCallback, type Tree } from '@nx/devkit';

import { normalizePrimitiveOptions } from '../../utils/normalize-options.js';
import type { ResourceGeneratorSchema } from './schema.js';

export async function resourceGenerator(
  tree: Tree,
  schema: ResourceGeneratorSchema,
): Promise<GeneratorCallback | void> {
  const options = normalizePrimitiveOptions(tree, schema, 'resources');
  const isTemplate = schema.template ?? false;

  generateFiles(tree, join(__dirname, 'files'), options.directory, {
    ...options,
    isTemplate,
    tmpl: '',
  });

  if (!schema.skipFormat) {
    await formatFiles(tree);
  }
}

export default resourceGenerator;
