/**
 * npm source: pack + extract to temp directory.
 * Supports --registry for private registries.
 */

import * as path from 'path';
import * as fs from 'fs';
import { runCmd } from '@frontmcp/utils';

export async function fetchFromNpm(pkg: string, tmpDir: string, registryUrl?: string): Promise<string> {
  // npm pack downloads a tarball to the target directory
  const packArgs = ['pack', pkg, '--pack-destination', tmpDir];
  if (registryUrl) {
    packArgs.push('--registry', registryUrl);
  }

  await runCmd('npm', packArgs);

  // Find the tarball - derive expected name from package to disambiguate
  const files = fs.readdirSync(tmpDir).filter((f: string) => f.endsWith('.tgz'));
  if (files.length === 0) {
    throw new Error(`npm pack did not produce a tarball for "${pkg}"`);
  }

  // npm pack produces tarballs like scope-name-version.tgz (@ removed, / replaced by -)
  const normalizedPkg = pkg.replace(/^@/, '').replace(/\//g, '-').replace(/@.*$/, '');
  const match = files.find((f) => f.startsWith(normalizedPkg));
  const tarball = path.join(tmpDir, match ?? files[0]);

  // Extract the tarball
  const extractDir = path.join(tmpDir, 'package');
  await runCmd('tar', ['xzf', tarball, '-C', tmpDir]);

  if (!fs.existsSync(extractDir)) {
    throw new Error(`Extracted package not found at ${extractDir}`);
  }

  return extractDir;
}
