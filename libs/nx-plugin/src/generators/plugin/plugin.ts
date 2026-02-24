import { type Tree, formatFiles, generateFiles, type GeneratorCallback } from '@nx/devkit';
import { join } from 'path';
import type { PluginGeneratorSchema } from './schema.js';
import { normalizePrimitiveOptions } from '../../utils/normalize-options.js';
import { toPropertyName } from '../../utils/names.js';

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
