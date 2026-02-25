import { type Tree, formatFiles, generateFiles, type GeneratorCallback } from '@nx/devkit';
import { join } from 'path';
import type { PromptGeneratorSchema } from './schema.js';
import { normalizePrimitiveOptions } from '../../utils/normalize-options.js';

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
