import { join } from 'path';

import { formatFiles, generateFiles, names, type GeneratorCallback, type Tree } from '@nx/devkit';

import { addUiEntry } from '../ui-shared/add-ui-entry.js';
import { ensureUiPackage } from '../ui-shared/ensure-ui-package.js';
import type { UiShellGeneratorSchema } from './schema.js';

const PACKAGE_ROOT = 'ui/shells';
const IMPORT_PATH = '@frontmcp/ui-shells';

export async function uiShellGenerator(tree: Tree, schema: UiShellGeneratorSchema): Promise<GeneratorCallback | void> {
  const { className, fileName } = names(schema.name);
  if (!/^[a-z][a-z0-9-]*$/.test(fileName)) {
    throw new Error(
      `The shell name "${schema.name}" becomes the folder and import path "${fileName}", which must start with a ` +
        'letter and have only letters, digits and dashes. Use a kebab-case name such as admin-dashboard.',
    );
  }

  const installTask = ensureUiPackage(tree, { packageRoot: PACKAGE_ROOT, projectName: 'ui-shells', kind: 'shell' });

  // Generate shell files from templates (kebab-case naming)
  generateFiles(tree, join(__dirname, 'files'), `${PACKAGE_ROOT}/src`, {
    className,
    fileName,
    name: schema.name,
    description: schema.description ?? '',
    tmpl: '',
  });

  // Add entry point to project.json, tsconfig.base.json, and barrel index.ts
  addUiEntry(tree, {
    packageRoot: PACKAGE_ROOT,
    entryName: fileName,
    importPath: IMPORT_PATH,
  });

  if (!schema.skipFormat) {
    await formatFiles(tree);
  }

  return installTask;
}

export default uiShellGenerator;
