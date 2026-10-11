/**
 * Ship `build.dependencies.nativeAddons` in an mcpb archive. The server bundle
 * keeps each native addon external (a `.node` binary cannot be bundled), so the
 * archive carries the addon, with its dependencies, in `server/node_modules/`.
 *
 * Packages are resolved the way Node resolves them (the nearest
 * `node_modules/<name>` walking up), from their real path so pnpm and yarn
 * layouts find their dependencies too. Listed addons take the top-level slots
 * first; a second version of a name is nested under the package that needs it.
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
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

interface PlacedPackage {
  addon: string;
  sourceDir: string;
  destDir: string;
}

const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/i;

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

function dependenciesOf(manifest: PackageManifest | null): Array<{ name: string; required: boolean }> {
  const optional = manifest?.optionalDependencies ?? {};
  const optionalPeers = manifest?.peerDependenciesMeta ?? {};
  return [
    ...Object.keys(manifest?.dependencies ?? {})
      .filter((name) => !(name in optional))
      .map((name) => ({ name, required: true })),
    ...Object.keys(manifest?.peerDependencies ?? {})
      .filter((name) => !optionalPeers[name]?.optional)
      .map((name) => ({ name, required: true })),
    ...Object.keys(optional).map((name) => ({ name, required: false })),
  ];
}

export async function copyNativeAddons(options: {
  addons: string[];
  projectDir: string;
  serverDir: string;
}): Promise<CopiedPackage[]> {
  const topNodeModules = path.join(options.serverDir, 'node_modules');
  const destBySource = new Map<string, string>();
  const occupiedDests = new Set<string>();
  const walkedSources = new Set<string>();
  const copied: CopiedPackage[] = [];

  function copiedLocation(sourceDir: string): string | undefined {
    for (const [copiedSource, copiedDest] of destBySource) {
      if (sourceDir === copiedSource) return copiedDest;
      if (sourceDir.startsWith(copiedSource + path.sep)) {
        return path.join(copiedDest, path.relative(copiedSource, sourceDir));
      }
    }
    return undefined;
  }

  async function copyPackage(name: string, sourceDir: string, destDir: string): Promise<void> {
    const relative = path.relative(topNodeModules, destDir);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Refusing to copy "${name}" outside ${topNodeModules}.`);
    }
    await cp(sourceDir, destDir, {
      recursive: true,
      dereference: true,
      filter: (source) => path.basename(source) !== '.git',
    });
    destBySource.set(sourceDir, destDir);
    occupiedDests.add(destDir);
    copied.push({ name, sourceDir, destDir });
  }

  async function walkDependencies(placed: PlacedPackage): Promise<void> {
    if (walkedSources.has(placed.sourceDir)) return;
    walkedSources.add(placed.sourceDir);
    const manifest = await readJSON<PackageManifest>(path.join(placed.sourceDir, 'package.json'));
    for (const { name, required } of dependenciesOf(manifest)) {
      if (!PACKAGE_NAME_PATTERN.test(name)) {
        throw new Error(`Native addon "${placed.addon}" depends on "${name}", which is not a valid package name.`);
      }
      const sourceDir = await resolvePackageDir(name, placed.sourceDir);
      if (!sourceDir) {
        if (!required) continue;
        throw new Error(
          `Native addon "${placed.addon}" depends on "${name}", which is not installed. Reinstall the project's dependencies.`,
        );
      }
      let destDir = copiedLocation(sourceDir);
      if (destDir === undefined) {
        const topDest = path.join(topNodeModules, name);
        destDir = occupiedDests.has(topDest) ? path.join(placed.destDir, 'node_modules', name) : topDest;
        await copyPackage(name, sourceDir, destDir);
      }
      await walkDependencies({ addon: placed.addon, sourceDir, destDir });
    }
  }

  const listed: PlacedPackage[] = [];
  for (const addon of options.addons) {
    if (!PACKAGE_NAME_PATTERN.test(addon)) {
      throw new Error(`"${addon}" in build.dependencies.nativeAddons is not a valid package name.`);
    }
    const sourceDir = await resolvePackageDir(addon, options.projectDir);
    if (!sourceDir) {
      throw new Error(
        `Native addon "${addon}" (build.dependencies.nativeAddons) is not installed under ${options.projectDir}/node_modules. Install it, or remove it from nativeAddons.`,
      );
    }
    const alreadyCopiedAt = copiedLocation(sourceDir);
    const destDir = alreadyCopiedAt ?? path.join(topNodeModules, addon);
    if (alreadyCopiedAt === undefined) await copyPackage(addon, sourceDir, destDir);
    listed.push({ addon, sourceDir, destDir });
  }
  for (const placed of listed) {
    await walkDependencies(placed);
  }
  return copied;
}

/** The OS an archive carrying native addon binaries runs on: the build machine's, when MCPB can name it. */
export function buildMachinePlatform(): McpbOsKey | undefined {
  return DEFAULT_PLATFORMS.find((os) => os === process.platform);
}
