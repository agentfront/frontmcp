import { type Tree, formatFiles, generateFiles, installPackagesTask, type GeneratorCallback } from '@nx/devkit';
import { join } from 'path';
import type { WorkspaceGeneratorSchema } from './schema.js';
import { normalizeOptions } from './lib/index.js';
import { getFrontmcpVersion } from '../../utils/versions.js';

export async function workspaceGenerator(tree: Tree, schema: WorkspaceGeneratorSchema): Promise<GeneratorCallback> {
  return workspaceGeneratorInternal(tree, schema);
}

async function workspaceGeneratorInternal(tree: Tree, schema: WorkspaceGeneratorSchema): Promise<GeneratorCallback> {
  const options = normalizeOptions(schema);
  const frontmcpVersion = `~${getFrontmcpVersion()}`;
  const nxVersion = '22.3.3';

  generateFiles(tree, join(__dirname, 'files'), options.workspaceRoot, {
    ...options,
    frontmcpVersion,
    nxVersion,
    tmpl: '',
    dot: '.',
  });

  // Create empty directories
  tree.write(join(options.workspaceRoot, 'apps', '.gitkeep'), '');
  tree.write(join(options.workspaceRoot, 'libs', '.gitkeep'), '');
  tree.write(join(options.workspaceRoot, 'servers', '.gitkeep'), '');

  // Compose with app generator when createSampleApp is true
  if (options.createSampleApp) {
    const { appGenerator } = await import('../app/app.js');
    await appGenerator(tree, {
      name: 'demo',
      directory: join(options.workspaceRoot, 'apps', 'demo'),
      tags: 'scope:apps',
      skipFormat: true,
    });
  }

  await formatFiles(tree);

  if (options.skipInstall) {
    return () => {
      /* noop */
    };
  }

  return () => {
    installPackagesTask(tree);
  };
}

export default workspaceGenerator;
