/**
 * Runtime packages an installed app needs next to its bundle.
 *
 * `frontmcp build` externalizes the FrontMCP runtime (single-copy semantics), so
 * the bundle copied into `~/.frontmcp/apps/<name>/` cannot run without them.
 * `@frontmcp/sdk` brings `@frontmcp/di`, `utils`, `auth`, ... as dependencies.
 *
 * The SDK `import()`s its optional peers lazily from its own location, so a peer
 * the project had installed is missing next to the installed SDK unless it is
 * installed there too (#679):
 *
 *   - `vectoriadb` is optional on paper, but every local `@App` builds a skill
 *     registry that loads it while the server starts. In a project it is always
 *     present (the `frontmcp` CLI depends on it); an installed app crashed with
 *     "skill storage needs the optional peer dependency 'vectoriadb'".
 *   - `tslib` — vectoriadb `require()`s it without declaring it as a dependency.
 *   - Any other optional SDK peer the project declares (`@frontmcp/storage-sqlite`,
 *     `@frontmcp/observability`, ...) is installed with the declared range.
 */

import * as fs from 'fs';
import * as path from 'path';

import { getSelfDependencyRange, getSelfVersion } from '../../core/version';

/** Installed for every app. */
const REQUIRED_PACKAGES = ['@frontmcp/sdk', 'reflect-metadata', 'vectoriadb', 'tslib'] as const;

/**
 * The optional peers of `@frontmcp/sdk` (other than `vectoriadb`) and `@frontmcp/utils`
 * (`peerDependenciesMeta` in their package.json — a unit test keeps them in sync). Both
 * packages load these lazily, so each is installed when the project declares it.
 */
export const OPTIONAL_RUNTIME_PEERS = [
  '@anthropic-ai/sdk',
  '@enclave-vm/core',
  '@frontmcp/observability',
  '@frontmcp/storage-sqlite',
  '@opentelemetry/api',
  '@opentelemetry/sdk-trace-base',
  '@vercel/kv',
  'ioredis',
  'openai',
] as const;

const FALLBACK_RANGES: Record<string, string> = {
  'reflect-metadata': '^0.2.2',
  vectoriadb: '^2.3.0',
  tslib: '^2.3.0',
};

interface DeclaredRanges {
  ranges: Record<string, string>;
  optional: Set<string>;
}

/** Declared ranges by name, with npm's precedence: optionalDependencies > dependencies > dev/peer. */
function readDeclaredRanges(packageDir: string): DeclaredRanges {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf-8')) as Record<
      string,
      Record<string, string> | undefined
    >;
    const optionalDependencies = pkg['optionalDependencies'] ?? {};
    return {
      ranges: {
        ...pkg['peerDependencies'],
        ...pkg['devDependencies'],
        ...pkg['dependencies'],
        ...optionalDependencies,
      },
      optional: new Set(Object.keys(optionalDependencies)),
    };
  } catch {
    return { ranges: {}, optional: new Set() };
  }
}

/** Range used when the project does not declare a required package. */
function defaultRange(name: string): string {
  if (name.startsWith('@frontmcp/')) return getSelfVersion();
  // The CLI depends on these too; its range is what projects run with.
  return getSelfDependencyRange(name) ?? FALLBACK_RANGES[name] ?? 'latest';
}

/**
 * Turn a declared range into something `npm install` can resolve from the install
 * directory: relative `file:` targets are anchored to the project, and workspace/link
 * (or missing local) targets fall back to the default range.
 */
function normalizeRange(name: string, range: string, packageDir: string): string {
  if (range.startsWith('workspace:') || range.startsWith('link:')) return defaultRange(name);
  if (range.startsWith('file:')) {
    const target = range.slice('file:'.length);
    const absolute = path.resolve(packageDir, target);
    return fs.existsSync(absolute) ? `file:${absolute}` : defaultRange(name);
  }
  return range;
}

export interface RuntimePackageSpecs {
  required: string[];
  optional: string[];
}

/** `name@range` specs for the runtime packages, preferring the versions the project declares. */
export function resolveRuntimePackageSpecs(packageDir: string): RuntimePackageSpecs {
  const { ranges, optional } = readDeclaredRanges(packageDir);
  const required = REQUIRED_PACKAGES.map((name) => {
    const range = ranges[name];
    return `${name}@${range ? normalizeRange(name, range, packageDir) : defaultRange(name)}`;
  });
  const declaredPeers = OPTIONAL_RUNTIME_PEERS.filter((name) => ranges[name]);
  const specOf = (name: string): string => `${name}@${normalizeRange(name, ranges[name], packageDir)}`;
  return {
    required: [...required, ...declaredPeers.filter((name) => !optional.has(name)).map(specOf)],
    optional: declaredPeers.filter((name) => optional.has(name)).map(specOf),
  };
}
