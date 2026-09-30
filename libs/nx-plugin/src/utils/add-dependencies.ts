import { addDependenciesToPackageJson, type GeneratorCallback, type Tree } from '@nx/devkit';

export function addFrontmcpDependencies(
  tree: Tree,
  dependencies: Record<string, string>,
  devDependencies: Record<string, string> = {},
  options: { keepExistingVersions?: boolean } = {},
): GeneratorCallback {
  return addDependenciesToPackageJson(tree, dependencies, devDependencies, undefined, options.keepExistingVersions);
}
