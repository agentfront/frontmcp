import { type Tree, formatFiles, generateFiles, names, type GeneratorCallback } from '@nx/devkit';
import { join } from 'path';
import type { UiComponentGeneratorSchema } from './schema.js';
import { addUiEntry } from '../ui-shared/add-ui-entry.js';

const PACKAGE_ROOT = 'ui/components';
const IMPORT_PATH = '@frontmcp/ui-components';

export async function uiComponentGenerator(
  tree: Tree,
  schema: UiComponentGeneratorSchema,
): Promise<GeneratorCallback | void> {
  const { className } = names(schema.name);

  // Generate component files from templates
  generateFiles(tree, join(__dirname, 'files'), `${PACKAGE_ROOT}/src`, {
    className,
    name: schema.name,
    description: schema.description ?? '',
    tmpl: '',
  });

  // Add entry point to project.json, tsconfig.base.json, and barrel index.ts
  addUiEntry(tree, {
    packageRoot: PACKAGE_ROOT,
    entryName: className,
    importPath: IMPORT_PATH,
  });

  if (!schema.skipFormat) {
    await formatFiles(tree);
  }
}

export default uiComponentGenerator;
