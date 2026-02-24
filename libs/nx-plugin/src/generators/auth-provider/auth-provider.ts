import { type Tree, formatFiles, generateFiles, names, type GeneratorCallback } from '@nx/devkit';
import { join } from 'path';
import type { AuthProviderGeneratorSchema } from './schema.js';
import { normalizePrimitiveOptions } from '../../utils/normalize-options.js';

export async function authProviderGenerator(
  tree: Tree,
  schema: AuthProviderGeneratorSchema,
): Promise<GeneratorCallback | void> {
  const options = normalizePrimitiveOptions(tree, schema, 'auth');
  const authType = schema.type ?? 'bearer';
  const constantName = names(schema.name).constantName;

  generateFiles(tree, join(__dirname, 'files'), options.directory, {
    ...options,
    authType,
    constantName,
    tmpl: '',
  });

  if (!schema.skipFormat) {
    await formatFiles(tree);
  }
}

export default authProviderGenerator;
