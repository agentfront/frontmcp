import { join } from 'path';

interface SelfPackageJson {
  version: string;
  dependencies?: Record<string, string>;
  engines?: { node?: string };
}

function readSelfPackageJson(): SelfPackageJson {
  return require(join(__dirname, '../../package.json')) as SelfPackageJson;
}

export function getSelfVersion(): string {
  return readSelfPackageJson().version;
}

/** The Node.js range FrontMCP requires: this CLI's `engines.node`, e.g. `>=24.0.0`. */
export function getSelfNodeRange(): string {
  const nodeRange = readSelfPackageJson().engines?.node;
  if (!nodeRange) throw new Error('The frontmcp package.json declares no engines.node range');
  return nodeRange;
}

/** The lowest Node.js version this CLI's `engines.node` range allows: `24.0.0` for `>=24.0.0`. */
export function getSelfMinNodeVersion(): string {
  const minimum = getSelfNodeRange().match(/\d+(?:\.\d+){0,2}/)?.[0];
  if (!minimum) throw new Error('The frontmcp package.json engines.node range names no version');
  return minimum;
}

/** The lowest Node.js major a range allows, or this CLI's own when the range names none: `24` for `>=24.0.0`. */
export function minNodeMajorOf(nodeRange: string): number {
  const major = nodeRange.match(/\d+/)?.[0] ?? getSelfMinNodeVersion();
  return parseInt(major, 10);
}

/** The range this CLI declares for one of its own dependencies, if any. */
export function getSelfDependencyRange(name: string): string | undefined {
  try {
    return readSelfPackageJson().dependencies?.[name];
  } catch {
    return undefined;
  }
}
