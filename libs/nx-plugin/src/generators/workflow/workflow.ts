import { type Tree, formatFiles, generateFiles, type GeneratorCallback } from '@nx/devkit';
import { join } from 'path';
import type { WorkflowGeneratorSchema } from './schema.js';
import { normalizePrimitiveOptions } from '../../utils/normalize-options.js';

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
