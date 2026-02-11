/**
 * Git source: clone repo to temp directory.
 */

import * as path from 'path';
import { runCmd } from '@frontmcp/utils';

export async function fetchFromGit(url: string, tmpDir: string): Promise<string> {
  // Normalize URL
  let gitUrl = url;
  if (gitUrl.startsWith('github:')) {
    gitUrl = `https://github.com/${gitUrl.slice('github:'.length)}.git`;
  }
  if (gitUrl.startsWith('git+')) {
    gitUrl = gitUrl.slice(4);
  }

  const cloneDir = path.join(tmpDir, 'package');
  await runCmd('git', ['clone', '--depth', '1', gitUrl, cloneDir]);

  return cloneDir;
}
