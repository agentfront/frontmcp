import { type Tree, formatFiles, generateFiles, names as nxNames, type GeneratorCallback } from '@nx/devkit';
import { join } from 'path';
import type { ServerGeneratorSchema } from './schema.js';
import { normalizeOptions } from './lib/index.js';

export async function serverGenerator(tree: Tree, schema: ServerGeneratorSchema): Promise<GeneratorCallback | void> {
  return serverGeneratorInternal(tree, schema);
}

async function serverGeneratorInternal(tree: Tree, schema: ServerGeneratorSchema): Promise<GeneratorCallback | void> {
  const options = normalizeOptions(schema);

  const templateVars = {
    ...options,
    names: nxNames,
    tmpl: '',
    dot: '.',
  };

  // Generate common files (main.ts, project.json, tsconfig)
  generateFiles(tree, join(__dirname, 'files', 'common'), options.projectRoot, templateVars);

  // Generate target-specific files
  const targetDir = join(__dirname, 'files', options.deploymentTarget);
  generateFiles(tree, targetDir, options.projectRoot, templateVars);

  if (!options.skipFormat) {
    await formatFiles(tree);
  }
}

export default serverGenerator;
