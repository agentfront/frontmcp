import { join } from 'path';

import { formatFiles, generateFiles, type GeneratorCallback, type Tree } from '@nx/devkit';

import { addTsPathAlias } from '../../utils/project-paths.js';
import { normalizeOptions, type NormalizedLibOptions } from './lib/index.js';
import type { LibGeneratorSchema } from './schema.js';

/**
 * Plugin and adapter libraries start from the class the `plugin` / `adapter` generators write,
 * so there is one template per class instead of two that drift apart.
 */
const CLASS_GENERATOR: Partial<Record<NormalizedLibOptions['libType'], string>> = {
  plugin: 'plugin',
  adapter: 'adapter',
};

export async function libGenerator(tree: Tree, schema: LibGeneratorSchema): Promise<GeneratorCallback | void> {
  return libGeneratorInternal(tree, schema);
}

async function libGeneratorInternal(tree: Tree, schema: LibGeneratorSchema): Promise<GeneratorCallback | void> {
  const options = normalizeOptions(tree, schema);
  const substitutions = { ...options, tmpl: '' };

  // Generate project config files (project.json, tsconfig, jest)
  generateFiles(tree, join(__dirname, 'lib-project-files'), options.projectRoot, substitutions);

  // Generate type-specific source files (barrel and starter spec)
  generateFiles(tree, join(__dirname, 'files', options.libType), options.projectRoot, substitutions);

  const classGenerator = CLASS_GENERATOR[options.libType];
  if (classGenerator) {
    const srcDir = join(options.projectRoot, 'src');
    generateFiles(tree, join(__dirname, '..', classGenerator, 'files'), srcDir, substitutions);
    // The plugin generator's opt-in context extension is not part of a new library.
    const contextExtension = join(srcDir, `${options.fileName}.context-extension.ts`);
    if (tree.exists(contextExtension)) tree.delete(contextExtension);
  }

  addTsPathAlias(tree, options.importPath, `${options.projectRoot}/src/index.ts`);

  if (!options.skipFormat) {
    await formatFiles(tree);
  }
}

export default libGenerator;
