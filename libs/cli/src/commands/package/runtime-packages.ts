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

/** `name@range` specs for the runtime packages, preferring the versions the project declares. */
export function resolveRuntimePackageSpecs(packageDir: string): string[] {
  const declared = readDeclaredRanges(packageDir);
  return RUNTIME_PACKAGES.map((name) => {
    const range = declared[name] ?? (name === 'reflect-metadata' ? REFLECT_METADATA_RANGE : getSelfVersion());
    return `${name}@${range}`;
  });
}
