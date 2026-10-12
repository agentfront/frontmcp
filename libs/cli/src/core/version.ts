import { readFileSync } from 'fs';
import { join } from 'path';

interface SelfPackageJson {
  version: string;
  dependencies?: Record<string, string>;
  engines?: { node?: string };
}

function readSelfPackageJson(): SelfPackageJson {
  const pkgPath = join(__dirname, '../../package.json');
  return JSON.parse(readFileSync(pkgPath, 'utf-8')) as SelfPackageJson;
}

export function getSelfVersion(): string {
  return readSelfPackageJson().version;
}

/** The lowest Node.js version this CLI's `engines.node` range allows: `24.0.0` for `>=24.0.0`. */
export function getSelfMinNodeVersion(): string {
  const nodeRange = readSelfPackageJson().engines?.node;
  const minimum = nodeRange?.match(/\d+(?:\.\d+){0,2}/)?.[0];
  if (!minimum) throw new Error('The frontmcp package.json declares no engines.node range');
  return minimum;
}

/** The range this CLI declares for one of its own dependencies, if any. */
export function getSelfDependencyRange(name: string): string | undefined {
  try {
    return readSelfPackageJson().dependencies?.[name];
  } catch {
    return undefined;
  }
}
