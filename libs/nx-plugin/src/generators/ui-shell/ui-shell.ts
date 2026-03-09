import { type Tree, formatFiles, generateFiles, names, type GeneratorCallback } from '@nx/devkit';
import { join } from 'path';
import type { UiShellGeneratorSchema } from './schema.js';
import { addUiEntry } from '../ui-shared/add-ui-entry.js';

const PACKAGE_ROOT = 'ui/shells';
const IMPORT_PATH = '@frontmcp/ui-shells';

export async function uiShellGenerator(tree: Tree, schema: UiShellGeneratorSchema): Promise<GeneratorCallback | void> {
  const { className, fileName } = names(schema.name);

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
}

export default uiShellGenerator;
