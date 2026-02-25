import { type Tree, formatFiles, generateFiles, type GeneratorCallback } from '@nx/devkit';
import { join } from 'path';
import type { SkillGeneratorSchema } from './schema.js';
import { normalizePrimitiveOptions } from '../../utils/normalize-options.js';

export async function skillGenerator(tree: Tree, schema: SkillGeneratorSchema): Promise<GeneratorCallback | void> {
  const options = normalizePrimitiveOptions(tree, schema, 'skills');
  const toolRefs = schema.tools
    ? schema.tools
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  generateFiles(tree, join(__dirname, 'files'), options.directory, {
    ...options,
    toolRefs,
    tmpl: '',
  });

  if (!schema.skipFormat) {
    await formatFiles(tree);
  }
}

export default skillGenerator;
