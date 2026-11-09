import { join } from 'path';

import { formatFiles, generateFiles, type GeneratorCallback, type Tree } from '@nx/devkit';

import { normalizePrimitiveOptions } from '../../utils/normalize-options.js';
import type { JobGeneratorSchema } from './schema.js';

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
