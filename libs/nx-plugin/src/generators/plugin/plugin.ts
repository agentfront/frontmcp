import { join } from 'path';

import { formatFiles, generateFiles, type GeneratorCallback, type Tree } from '@nx/devkit';

import { toPropertyName } from '../../utils/names.js';
import { normalizePrimitiveOptions } from '../../utils/normalize-options.js';
import type { PluginGeneratorSchema } from './schema.js';

export async function pluginGenerator(tree: Tree, schema: PluginGeneratorSchema): Promise<GeneratorCallback | void> {
  const options = normalizePrimitiveOptions(tree, schema, 'plugins');
  const withContextExtension = schema.withContextExtension ?? false;
  const propertyName = toPropertyName(schema.name);

  generateFiles(tree, join(__dirname, 'files'), options.directory, {
    ...options,
    propertyName,
    tmpl: '',
  });

  // Remove context extension file if not requested
  if (!withContextExtension) {
    const extensionPath = join(options.directory, `${options.fileName}.context-extension.ts`);
    if (tree.exists(extensionPath)) {
      tree.delete(extensionPath);
    }
  }

  if (!schema.skipFormat) {
    await formatFiles(tree);
  }
}

export default pluginGenerator;
