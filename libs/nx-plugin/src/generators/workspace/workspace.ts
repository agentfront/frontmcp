import { type Tree, formatFiles, generateFiles, installPackagesTask, type GeneratorCallback } from '@nx/devkit';
import { execSync } from 'child_process';
import { join } from 'path';
import type { WorkspaceGeneratorSchema } from './schema.js';
import { normalizeOptions } from './lib/index.js';
import { getFrontmcpVersion, getNxVersion } from '../../utils/versions.js';

export async function workspaceGenerator(tree: Tree, schema: WorkspaceGeneratorSchema): Promise<GeneratorCallback> {
  return workspaceGeneratorInternal(tree, schema);
}

async function workspaceGeneratorInternal(tree: Tree, schema: WorkspaceGeneratorSchema): Promise<GeneratorCallback> {
  const options = normalizeOptions(schema);
  const frontmcpVersion = `~${getFrontmcpVersion()}`;
  const nxVersion = getNxVersion();

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
    if (!options.skipGit) {
      return () => {
        initGitRepository(options.workspaceRoot);
      };
    }
    return () => {
      /* noop */
    };
  }

  return () => {
    installPackagesTask(tree);
    if (!options.skipGit) {
      initGitRepository(options.workspaceRoot);
    }
  };
}

function initGitRepository(workspaceRoot: string): void {
  try {
    execSync('git init', { cwd: workspaceRoot, stdio: 'ignore' });
    execSync('git add -A', { cwd: workspaceRoot, stdio: 'ignore' });
    execSync('git commit -m "Initial commit"', { cwd: workspaceRoot, stdio: 'ignore' });
  } catch {
    // git may not be installed — silently skip
  }
}

export default workspaceGenerator;
