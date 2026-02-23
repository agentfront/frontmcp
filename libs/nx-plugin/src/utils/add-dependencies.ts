import { type Tree, addDependenciesToPackageJson, type GeneratorCallback } from '@nx/devkit';

export function addFrontmcpDependencies(
  tree: Tree,
  dependencies: Record<string, string>,
  devDependencies: Record<string, string> = {},
): GeneratorCallback {
  return addDependenciesToPackageJson(tree, dependencies, devDependencies);
}
