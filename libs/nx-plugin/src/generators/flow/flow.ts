import { join } from 'path';

import { formatFiles, generateFiles, type GeneratorCallback, type Tree } from '@nx/devkit';

import { normalizePrimitiveOptions } from '../../utils/normalize-options.js';
import type { FlowGeneratorSchema } from './schema.js';

export async function flowGenerator(tree: Tree, schema: FlowGeneratorSchema): Promise<GeneratorCallback | void> {
  const options = normalizePrimitiveOptions(tree, schema, 'flows');

  generateFiles(tree, join(__dirname, 'files'), options.directory, {
    ...options,
    tmpl: '',
  });

  if (!schema.skipFormat) {
    await formatFiles(tree);
  }
}

export default flowGenerator;
