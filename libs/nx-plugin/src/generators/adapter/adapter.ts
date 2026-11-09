import { join } from 'path';

import { formatFiles, generateFiles, type GeneratorCallback, type Tree } from '@nx/devkit';

import { normalizePrimitiveOptions } from '../../utils/normalize-options.js';
import type { AdapterGeneratorSchema } from './schema.js';

export async function adapterGenerator(tree: Tree, schema: AdapterGeneratorSchema): Promise<GeneratorCallback | void> {
  const options = normalizePrimitiveOptions(tree, schema, 'adapters');

  generateFiles(tree, join(__dirname, 'files'), options.directory, {
    ...options,
    tmpl: '',
  });

  if (!schema.skipFormat) {
    await formatFiles(tree);
  }
}

export default adapterGenerator;
