/**
 * Deterministic ZIP creation for MCPB archives.
 *
 * Determinism is achieved by:
 *   - walking the stage directory in sorted order
 *   - uniform mtime (`DETERMINISTIC_MTIME`) on every entry
 *   - forceZip64Format: false (yazl default — keeps the archive small & portable)
 *
 * Two back-to-back builds of the same staged directory produce byte-identical
 * `.mcpb` archives with matching SHA-256 hashes.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { DETERMINISTIC_MTIME } from './constants';

export interface ZipResult {
  /** Absolute path to the produced archive. */
  archivePath: string;
  /** Final archive size in bytes. */
  size: number;
  /** SHA-256 of the archive contents (lowercase hex). */
  sha256: string;
  /** Entry names in archive order (useful for tests/logging). */
  entries: string[];
}

export interface ZipOptions {
  /** Apply DETERMINISTIC_MTIME to every entry. @default true */
  deterministic?: boolean;
  /** When true, deflate entries; when false, store uncompressed. @default true */
  compress?: boolean;
}

/**
 * Recursively walk a directory and return every file's {archivePath, absPath}
 * pair. Archive paths use forward slashes regardless of host OS.
 */
export function listFilesForArchive(
  stageDir: string,
): Array<{ archivePath: string; absPath: string }> {
  const out: Array<{ archivePath: string; absPath: string }> = [];
  const stack: Array<{ dir: string; rel: string }> = [{ dir: stageDir, rel: '' }];
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) break;
    const { dir, rel } = next;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        stack.push({ dir: abs, rel: relPath });
      } else if (entry.isFile()) {
        out.push({ archivePath: relPath, absPath: abs });
      }
      // Symlinks and other types are deliberately skipped: MCPB archives are
      // expected to be portable across Windows/macOS/Linux consumers.
    }
  }
  return out.sort((a, b) => {
    if (a.archivePath < b.archivePath) return -1;
    if (a.archivePath > b.archivePath) return 1;
    return 0;
  });
}

/** Create a deterministic `.mcpb` archive from a staged directory. */
export async function createDeterministicZip(
  stageDir: string,
  archivePath: string,
  options: ZipOptions = {},
): Promise<ZipResult> {
  const yazl = require('yazl') as typeof import('yazl');
  const { deterministic = true, compress = true } = options;

  const files = listFilesForArchive(stageDir);
  const zip = new yazl.ZipFile();

  for (const { archivePath: rel, absPath } of files) {
    zip.addFile(absPath, rel, {
      mtime: deterministic ? DETERMINISTIC_MTIME : undefined,
      compress,
    });
  }
  zip.end({ forceZip64Format: false });

  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(archivePath);
    out.on('error', reject);
    out.on('close', () => resolve());
    zip.outputStream.on('error', reject);
    zip.outputStream.pipe(out);
  });

  const buf = fs.readFileSync(archivePath);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

  return {
    archivePath,
    size: buf.byteLength,
    sha256,
    entries: files.map((f) => f.archivePath),
  };
}
