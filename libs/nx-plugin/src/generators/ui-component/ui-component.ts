import { join } from 'path';

import { formatFiles, generateFiles, names, type GeneratorCallback, type Tree } from '@nx/devkit';

import { addUiEntry } from '../ui-shared/add-ui-entry.js';
import { ensureUiPackage } from '../ui-shared/ensure-ui-package.js';
import type { UiComponentGeneratorSchema } from './schema.js';

const PACKAGE_ROOT = 'ui/components';
const IMPORT_PATH = '@frontmcp/ui-components';

export async function uiComponentGenerator(
  tree: Tree,
  schema: UiComponentGeneratorSchema,
): Promise<GeneratorCallback | void> {
  const trimmedName = schema.name?.trim();
  if (!trimmedName) {
    throw new Error('Generator name must not be blank');
  }

  const { className } = names(trimmedName);

  const installTask = ensureUiPackage(tree, { packageRoot: PACKAGE_ROOT, projectName: 'ui-components', kind: 'react' });

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

  return installTask;
}

export default uiComponentGenerator;
