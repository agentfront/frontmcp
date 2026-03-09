/**
 * Git source: clone repo to temp directory.
 */

import * as path from 'path';
import { runCmd } from '@frontmcp/utils';

export async function fetchFromGit(url: string, tmpDir: string): Promise<string> {
  // Normalize URL
  let gitUrl = url;
  if (gitUrl.startsWith('github:')) {
    const slug = gitUrl.slice('github:'.length).replace(/\.git$/i, '');
    gitUrl = `https://github.com/${slug}.git`;
  }
  if (gitUrl.startsWith('git+')) {
    gitUrl = gitUrl.slice(4);
  }

  // Validate URL scheme to prevent argument injection (e.g., --upload-pack)
  const ALLOWED_PREFIXES = ['https://', 'http://', 'git://', 'ssh://', 'git@'];
  if (!ALLOWED_PREFIXES.some((prefix) => gitUrl.startsWith(prefix))) {
    throw new Error(`Invalid git URL: "${gitUrl}". URL must start with one of: ${ALLOWED_PREFIXES.join(', ')}`);
  }

  const cloneDir = path.join(tmpDir, 'package');
  await runCmd('git', ['clone', '--depth', '1', gitUrl, cloneDir]);

  return cloneDir;
}
