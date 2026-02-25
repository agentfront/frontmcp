import { readJsonFile } from '@nx/devkit';
import { join } from 'path';

let cachedVersion: string | undefined;

function readPluginVersion(): string {
  if (cachedVersion) return cachedVersion;
  const pkgPath = join(__dirname, '..', '..', 'package.json');
  const pkg = readJsonFile<{ version?: unknown }>(pkgPath);
  if (!pkg.version || typeof pkg.version !== 'string') {
    throw new Error(`@frontmcp/nx package.json at ${pkgPath} is missing a valid "version" field`);
  }
  cachedVersion = pkg.version;
  return cachedVersion;
}

export function getFrontmcpVersion(): string {
  return readPluginVersion();
}

export function getFrontmcpDependencies(): Record<string, string> {
  const range = `~${getFrontmcpVersion()}`;
  return {
    '@frontmcp/sdk': range,
    '@frontmcp/cli': range,
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
    nx: '22.3.3',
    '@nx/devkit': '22.3.3',
    '@nx/js': '22.3.3',
    '@nx/eslint': '22.3.3',
    '@nx/jest': '22.3.3',
    '@nx/esbuild': '22.3.3',
  };
}

export function getNxDevDependencies(): Record<string, string> {
  return {
    '@nx/workspace': '22.3.3',
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
