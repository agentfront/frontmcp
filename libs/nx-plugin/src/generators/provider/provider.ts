import { type Tree, formatFiles, generateFiles, names, type GeneratorCallback } from '@nx/devkit';
import { join } from 'path';
import type { ProviderGeneratorSchema } from './schema.js';
import { normalizePrimitiveOptions } from '../../utils/normalize-options.js';

export async function providerGenerator(
  tree: Tree,
  schema: ProviderGeneratorSchema,
): Promise<GeneratorCallback | void> {
  const options = normalizePrimitiveOptions(tree, schema, 'providers');
  const scope = schema.scope ?? 'singleton';
  const constantName = names(schema.name).constantName;

  generateFiles(tree, join(__dirname, 'files'), options.directory, {
    ...options,
    scope,
    constantName,
    tmpl: '',
  });

  if (!schema.skipFormat) {
    await formatFiles(tree);
  }
}

export default providerGenerator;
