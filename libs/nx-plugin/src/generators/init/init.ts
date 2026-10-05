import { formatFiles, readNxJson, updateNxJson, type GeneratorCallback, type Tree } from '@nx/devkit';

import { addFrontmcpDependencies } from '../../utils/add-dependencies.js';
import { getFrontmcpDependencies, getFrontmcpDevDependencies, getJestDevDependencies } from '../../utils/versions.js';
import type { InitGeneratorSchema } from './schema.js';

const BUILD_EXECUTORS = ['@frontmcp/nx:build', '@frontmcp/nx:build-exec'] as const;
const TEST_EXECUTOR = '@frontmcp/nx:test';

/**
 * Executors are only cached when the target (or a `targetDefaults` entry for
 * the executor) says so — Nx does not read that from the plugin itself.
 */
function makeExecutorsCacheable(tree: Tree): void {
  const nxJson = readNxJson(tree);
  if (!nxJson) return;

  const targetDefaults = nxJson.targetDefaults ?? {};
  const inputs = nxJson.namedInputs?.['production'] ? ['production', '^production'] : undefined;

  for (const executor of BUILD_EXECUTORS) {
    targetDefaults[executor] = {
      cache: true,
      dependsOn: ['^build'],
      ...(inputs && { inputs }),
      ...targetDefaults[executor],
    };
  }
  // Default inputs, as in the workspace generator's nx.json: `production` leaves out the spec files
  targetDefaults[TEST_EXECUTOR] = { cache: true, ...targetDefaults[TEST_EXECUTOR] };

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
