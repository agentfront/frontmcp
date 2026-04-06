import { readJsonFile } from '@nx/devkit';
import { join } from 'path';
import { existsSync } from 'fs';

let cachedVersion: string | undefined;

function readPluginVersion(): string {
  if (cachedVersion) return cachedVersion;

  // Walk up from __dirname to find the @frontmcp/nx package.json.
  // In monorepo (src/utils/ or dist/utils/): ../../package.json
  // When published to npm (utils/): ../package.json
  let dir = __dirname;
  for (let i = 0; i < 4; i++) {
    dir = join(dir, '..');
    const candidate = join(dir, 'package.json');
    if (!existsSync(candidate)) continue;
    const pkg = readJsonFile<{ name?: string; version?: unknown }>(candidate);
    if (pkg.name === '@frontmcp/nx' && typeof pkg.version === 'string') {
      cachedVersion = pkg.version;
      return cachedVersion;
    }
  }

  throw new Error(`@frontmcp/nx package.json not found (searched from ${__dirname})`);
}

export function getFrontmcpVersion(): string {
  return readPluginVersion();
}

export function getFrontmcpDependencies(): Record<string, string> {
  const range = `~${getFrontmcpVersion()}`;
  return {
    '@frontmcp/sdk': range,
    frontmcp: range,
    'reflect-metadata': '^0.2.2',
    zod: '^4.0.0',
  };
}

export function getFrontmcpDevDependencies(): Record<string, string> {
  const range = `~${getFrontmcpVersion()}`;
  return {
    '@frontmcp/testing': range,
  };
}

export function getNxDependencies(): Record<string, string> {
  return {
    nx: '22.6.4',
    '@nx/devkit': '22.6.4',
    '@nx/js': '22.6.4',
    '@nx/eslint': '22.6.4',
    '@nx/jest': '22.6.4',
    '@nx/esbuild': '22.6.4',
  };
}

export function getNxDevDependencies(): Record<string, string> {
  return {
    '@nx/workspace': '22.6.4',
    '@swc-node/register': '~1.9.1',
    '@swc/core': '~1.5.7',
    '@swc/helpers': '~0.5.11',
    '@swc/jest': '~0.2.39',
    '@types/jest': '^30.0.0',
    '@types/node': '^24.0.0',
    jest: '^30.0.2',
    typescript: '~5.9.2',
    tslib: '^2.3.0',
    prettier: '~3.6.2',
  };
}
