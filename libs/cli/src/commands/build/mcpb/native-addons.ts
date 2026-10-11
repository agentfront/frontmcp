/**
 * Ship `build.dependencies.nativeAddons` in an mcpb archive. The server bundle
 * keeps each native addon external (a `.node` binary cannot be bundled), so the
 * archive carries the addon, with its dependencies, in `server/node_modules/`.
 *
 * Packages are resolved the way Node resolves them (the nearest
 * `node_modules/<name>` walking up), from their real path so pnpm and yarn
 * layouts find their dependencies too. A second version of a name already
 * placed at the top is nested under the package that needs it.
 */

import * as path from 'path';

import { cp, fileExists, readJSON, realpath } from '@frontmcp/utils';

import { DEFAULT_PLATFORMS, type McpbOsKey } from './constants';

export interface CopiedPackage {
  name: string;
  sourceDir: string;
  destDir: string;
}

interface PackageManifest {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface PlacedPackage {
  sourceDir: string;
  destDir: string;
}

/** Real path of the package `name` as Node resolves it from `fromDir`, or undefined when it is not installed. */
export async function resolvePackageDir(name: string, fromDir: string): Promise<string | undefined> {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name);
    if (await fileExists(path.join(candidate, 'package.json'))) return realpath(candidate);
    const parentDir = path.dirname(dir);
    if (parentDir === dir) return undefined;
    dir = parentDir;
  }
}

export async function copyNativeAddons(options: {
  addons: string[];
  projectDir: string;
  serverDir: string;
}): Promise<CopiedPackage[]> {
  const topNodeModules = path.join(options.serverDir, 'node_modules');
  const sourceByDest = new Map<string, string>();
  const walkedDests = new Set<string>();
  const copied: CopiedPackage[] = [];

  async function copyOnce(name: string, sourceDir: string, dependent: PlacedPackage | undefined): Promise<string | undefined> {
    const topDest = path.join(topNodeModules, name);
    const placedAtTop = sourceByDest.get(topDest);
    if (placedAtTop === sourceDir) return undefined;
    const destDir = placedAtTop === undefined ? topDest : path.join(dependent?.destDir ?? options.serverDir, 'node_modules', name);
    if (sourceByDest.get(destDir) === sourceDir) return undefined;
    await cp(sourceDir, destDir, { recursive: true, dereference: true });
    sourceByDest.set(destDir, sourceDir);
    copied.push({ name, sourceDir, destDir });
    return destDir;
  }

  async function place(name: string, addon: string, dependent: PlacedPackage | undefined, required: boolean): Promise<void> {
    const sourceDir = await resolvePackageDir(name, dependent?.sourceDir ?? options.projectDir);
    if (!sourceDir) {
      if (!required) return;
      throw new Error(
        dependent
          ? `Native addon "${addon}" depends on "${name}", which is not installed. Reinstall the project's dependencies.`
          : `Native addon "${name}" (build.dependencies.nativeAddons) is not installed under ${options.projectDir}/node_modules. Install it, or remove it from nativeAddons.`,
      );
    }
    const nestedInDependent = dependent !== undefined && sourceDir.startsWith(dependent.sourceDir + path.sep);
    const destDir = nestedInDependent
      ? path.join(dependent.destDir, path.relative(dependent.sourceDir, sourceDir))
      : await copyOnce(name, sourceDir, dependent);
    if (destDir === undefined || walkedDests.has(destDir)) return;
    walkedDests.add(destDir);

    const manifest = await readJSON<PackageManifest>(path.join(sourceDir, 'package.json'));
    const placed = { sourceDir, destDir };
    for (const dependency of Object.keys(manifest?.dependencies ?? {})) {
      await place(dependency, addon, placed, true);
    }
    for (const dependency of Object.keys(manifest?.optionalDependencies ?? {})) {
      await place(dependency, addon, placed, false);
    }
  }

  for (const addon of options.addons) {
    await place(addon, addon, undefined, true);
  }
  return copied;
}

/** The OS an archive carrying native addon binaries runs on: the build machine's, when MCPB can name it. */
export function buildMachinePlatform(): McpbOsKey | undefined {
  return DEFAULT_PLATFORMS.find((os) => os === process.platform);
}
