import { join } from 'path';

import { formatFiles, generateFiles, type GeneratorCallback, type Tree } from '@nx/devkit';

import { normalizePrimitiveOptions } from '../../utils/normalize-options.js';
import type { PromptGeneratorSchema } from './schema.js';

export async function promptGenerator(tree: Tree, schema: PromptGeneratorSchema): Promise<GeneratorCallback | void> {
  const options = normalizePrimitiveOptions(tree, schema, 'prompts');
  const promptArgs = schema.arguments
    ? schema.arguments
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean)
    : [];

  generateFiles(tree, join(__dirname, 'files'), options.directory, {
    ...options,
    promptArgs,
    tmpl: '',
  });

  if (!schema.skipFormat) {
    await formatFiles(tree);
  }
}

export default promptGenerator;
