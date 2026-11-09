import { join } from 'path';

import { formatFiles, generateFiles, type GeneratorCallback, type Tree } from '@nx/devkit';

import { normalizePrimitiveOptions } from '../../utils/normalize-options.js';
import type { ToolGeneratorSchema } from './schema.js';

export async function toolGenerator(tree: Tree, schema: ToolGeneratorSchema): Promise<GeneratorCallback | void> {
  const options = normalizePrimitiveOptions(tree, schema, 'tools');

  generateFiles(tree, join(__dirname, 'files'), options.directory, {
    ...options,
    tmpl: '',
  });

  if (!schema.skipFormat) {
    await formatFiles(tree);
  }
}

export default toolGenerator;
