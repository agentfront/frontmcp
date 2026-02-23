import {
  type Tree,
  formatFiles,
  generateFiles,
  updateJson,
  type GeneratorCallback,
} from '@nx/devkit';
import { join } from 'path';
import type { LibGeneratorSchema } from './schema.js';
import { normalizeOptions } from './lib/index.js';

export async function libGenerator(tree: Tree, schema: LibGeneratorSchema): Promise<GeneratorCallback | void> {
  return libGeneratorInternal(tree, schema);
}

async function libGeneratorInternal(
  tree: Tree,
  schema: LibGeneratorSchema,
): Promise<GeneratorCallback | void> {
  const options = normalizeOptions(schema);

  // Generate project config files (project.json, tsconfig, jest)
  generateFiles(tree, join(__dirname, 'lib-project-files'), options.projectRoot, {
    ...options,
    tmpl: '',
  });

  // Generate type-specific source files
  const templateDir = join(__dirname, 'files', options.libType);
  generateFiles(tree, templateDir, options.projectRoot, {
    ...options,
    tmpl: '',
  });

  // Add path mapping to tsconfig.base.json if it exists
  if (tree.exists('tsconfig.base.json')) {
    updateJson(tree, 'tsconfig.base.json', (json) => {
      json.compilerOptions = json.compilerOptions ?? {};
      json.compilerOptions.paths = json.compilerOptions.paths ?? {};
      json.compilerOptions.paths[options.importPath] = [`${options.projectRoot}/src/index.ts`];
      return json;
    });
  }

  if (!options.skipFormat) {
    await formatFiles(tree);
  }
}

export default libGenerator;
