import { type Tree, formatFiles, generateFiles, type GeneratorCallback } from '@nx/devkit';
import { join } from 'path';
import type { ResourceGeneratorSchema } from './schema.js';
import { normalizePrimitiveOptions } from '../../utils/normalize-options.js';

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
