import { formatFiles, readNxJson, updateNxJson, type GeneratorCallback, type Tree } from '@nx/devkit';

import { addFrontmcpDependencies } from '../../utils/add-dependencies.js';
import { getFrontmcpDependencies, getFrontmcpDevDependencies, getJestDevDependencies } from '../../utils/versions.js';
import type { InitGeneratorSchema } from './schema.js';

const CACHEABLE_EXECUTORS = ['@frontmcp/nx:build', '@frontmcp/nx:build-exec', '@frontmcp/nx:test'] as const;

/**
 * Executors are only cached when the target (or a `targetDefaults` entry for
 * the executor) says so — Nx does not read that from the plugin itself.
 */
function makeExecutorsCacheable(tree: Tree): void {
  const nxJson = readNxJson(tree);
  if (!nxJson) return;

  const targetDefaults = nxJson.targetDefaults ?? {};
  const inputs = nxJson.namedInputs?.['production'] ? ['production', '^production'] : undefined;

  for (const executor of CACHEABLE_EXECUTORS) {
    const existing = targetDefaults[executor];
    targetDefaults[executor] = {
      cache: true,
      ...(executor !== '@frontmcp/nx:test' && { dependsOn: ['^build'] }),
      ...(inputs && { inputs }),
      ...existing,
    };
  }

  updateNxJson(tree, { ...nxJson, targetDefaults });
}

export async function initGenerator(tree: Tree, schema: InitGeneratorSchema = {}): Promise<GeneratorCallback> {
  makeExecutorsCacheable(tree);

  const installTask = schema.skipPackageJson
    ? () => undefined
    : addFrontmcpDependencies(
        tree,
        { ...getFrontmcpDependencies(), tslib: '^2.3.0' },
        { ...getFrontmcpDevDependencies(), ...getJestDevDependencies() },
        { keepExistingVersions: true },
      );

  if (!schema.skipFormat) {
    await formatFiles(tree);
  }

  return installTask;
}

export default initGenerator;
