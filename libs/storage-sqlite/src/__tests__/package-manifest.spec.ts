import * as fs from 'fs';
import * as path from 'path';

interface PackageManifest {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'),
) as PackageManifest;

describe('the @frontmcp/storage-sqlite package manifest (#1512)', () => {
  it('declares better-sqlite3 as an optional peer, so an install does not build it', () => {
    expect(manifest.peerDependencies?.['better-sqlite3']).toMatch(/^\^12\./);
    expect(manifest.peerDependenciesMeta?.['better-sqlite3']).toEqual({ optional: true });
  });

  it('does not install better-sqlite3 as a dependency or an optional dependency', () => {
    expect(manifest.dependencies ?? {}).not.toHaveProperty('better-sqlite3');
    expect(manifest.optionalDependencies ?? {}).not.toHaveProperty('better-sqlite3');
  });
});
