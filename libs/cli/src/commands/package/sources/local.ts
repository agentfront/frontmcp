/**
 * Local path source: copy directory to temp.
 */

import * as path from 'path';
import * as fs from 'fs';
import { cp } from '@frontmcp/utils';

export async function fetchFromLocal(localPath: string, tmpDir: string): Promise<string> {
  const resolved = path.resolve(localPath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Local path not found: ${resolved}`);
  }

  const stat = fs.statSync(resolved);

  if (stat.isDirectory()) {
    const dest = path.join(tmpDir, 'package');
    await cp(resolved, dest, { recursive: true });
    return dest;
  }

  // Single file — copy it
  const dest = path.join(tmpDir, 'package');
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(resolved, path.join(dest, path.basename(resolved)));
  return dest;
}
