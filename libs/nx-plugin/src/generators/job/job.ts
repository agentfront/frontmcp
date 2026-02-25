import { type Tree, formatFiles, generateFiles, type GeneratorCallback } from '@nx/devkit';
import { join } from 'path';
import type { JobGeneratorSchema } from './schema.js';
import { normalizePrimitiveOptions } from '../../utils/normalize-options.js';

export async function jobGenerator(tree: Tree, schema: JobGeneratorSchema): Promise<GeneratorCallback | void> {
  const options = normalizePrimitiveOptions(tree, schema, 'jobs');

  generateFiles(tree, join(__dirname, 'files'), options.directory, {
    ...options,
    tmpl: '',
  });

  if (!schema.skipFormat) {
    await formatFiles(tree);
  }
}

export default jobGenerator;
