import { join } from 'path';

import { formatFiles, generateFiles, type GeneratorCallback, type Tree } from '@nx/devkit';

import { normalizePrimitiveOptions } from '../../utils/normalize-options.js';
import type { WorkflowGeneratorSchema } from './schema.js';

export async function workflowGenerator(
  tree: Tree,
  schema: WorkflowGeneratorSchema,
): Promise<GeneratorCallback | void> {
  const options = normalizePrimitiveOptions(tree, schema, 'workflows');

  generateFiles(tree, join(__dirname, 'files'), options.directory, {
    ...options,
    tmpl: '',
  });

  if (!schema.skipFormat) {
    await formatFiles(tree);
  }
}

export default workflowGenerator;
