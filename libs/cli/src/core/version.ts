import { readFileSync } from 'fs';
import { join } from 'path';

interface SelfPackageJson {
  version: string;
  dependencies?: Record<string, string>;
}

function readSelfPackageJson(): SelfPackageJson {
  const pkgPath = join(__dirname, '../../package.json');
  return JSON.parse(readFileSync(pkgPath, 'utf-8')) as SelfPackageJson;
}

export function getSelfVersion(): string {
  return readSelfPackageJson().version;
}

/** The range this CLI declares for one of its own dependencies, if any. */
export function getSelfDependencyRange(name: string): string | undefined {
  try {
    return readSelfPackageJson().dependencies?.[name];
  } catch {
    return undefined;
  }
}
