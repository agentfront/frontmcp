import { join } from 'path';

import { formatFiles, generateFiles, type GeneratorCallback, type Tree } from '@nx/devkit';

import { normalizePrimitiveOptions } from '../../utils/normalize-options.js';
import type { ProviderGeneratorSchema } from './schema.js';

export async function providerGenerator(
  tree: Tree,
  schema: ProviderGeneratorSchema,
): Promise<GeneratorCallback | void> {
  const options = normalizePrimitiveOptions(tree, schema, 'providers');
  const scope = schema.scope ?? 'singleton';
  const scopeEnum = scope === 'singleton' ? 'GLOBAL' : 'CONTEXT';

  generateFiles(tree, join(__dirname, 'files'), options.directory, {
    ...options,
    scope,
    scopeEnum,
    tmpl: '',
  });

  if (!schema.skipFormat) {
    await formatFiles(tree);
  }
}

export default providerGenerator;
