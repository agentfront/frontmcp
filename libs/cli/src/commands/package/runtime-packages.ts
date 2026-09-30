/**
 * Runtime packages an installed app needs next to its bundle.
 *
 * `frontmcp build` externalizes the FrontMCP runtime (single-copy semantics), so
 * the bundle copied into `~/.frontmcp/apps/<name>/` cannot run without them.
 * `@frontmcp/sdk` brings `@frontmcp/di`, `utils`, `auth`, ... as dependencies.
 */

import * as fs from 'fs';
import * as path from 'path';

import { getSelfVersion } from '../../core/version';

const REFLECT_METADATA_RANGE = '^0.2.2';
const RUNTIME_PACKAGES = ['@frontmcp/sdk', 'reflect-metadata'] as const;

function readDeclaredRanges(packageDir: string): Record<string, string> {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf-8')) as Record<
      string,
      Record<string, string> | undefined
    >;
    return { ...pkg['peerDependencies'], ...pkg['devDependencies'], ...pkg['dependencies'] };
  } catch {
    return {};
  }
}

function defaultRange(name: (typeof RUNTIME_PACKAGES)[number]): string {
  return name === 'reflect-metadata' ? REFLECT_METADATA_RANGE : getSelfVersion();
}

/**
 * Turn a declared range into something `npm install` can resolve from the install
 * directory: relative `file:` targets are anchored to the project, and workspace/link
 * (or missing local) targets fall back to the default range.
 */
function normalizeRange(name: (typeof RUNTIME_PACKAGES)[number], range: string, packageDir: string): string {
  if (range.startsWith('workspace:') || range.startsWith('link:')) return defaultRange(name);
  if (range.startsWith('file:')) {
    const target = range.slice('file:'.length);
    const absolute = path.resolve(packageDir, target);
    return fs.existsSync(absolute) ? `file:${absolute}` : defaultRange(name);
  }
  return range;
}

/** `name@range` specs for the runtime packages, preferring the versions the project declares. */
export function resolveRuntimePackageSpecs(packageDir: string): string[] {
  const declared = readDeclaredRanges(packageDir);
  return RUNTIME_PACKAGES.map((name) => {
    const range = declared[name];
    return `${name}@${range ? normalizeRange(name, range, packageDir) : defaultRange(name)}`;
  });
}
