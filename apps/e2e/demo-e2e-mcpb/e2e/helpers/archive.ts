// Streamed binary entries (`.node` files) — @frontmcp/utils only writes text.
import { createWriteStream } from 'fs';
import * as path from 'path';

import type { Entry, ZipFile } from 'yauzl';

import { ensureDir, readFileBuffer, sha256Hex } from '@frontmcp/utils';

const yauzl = require('yauzl') as typeof import('yauzl');

export interface ArchiveContents {
  entries: string[];
  manifest: Record<string, unknown>;
}

/** Open a .mcpb archive and return its entry list + parsed manifest.json. */
export function readArchive(archivePath: string): Promise<ArchiveContents> {
  return new Promise<ArchiveContents>((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (err: Error | null, zip: ZipFile | undefined) => {
      if (err || !zip) {
        reject(err || new Error('yauzl returned no handle'));
        return;
      }
      const entries: string[] = [];
      let manifestRaw = '';

      zip.readEntry();
      zip.on('entry', (entry: Entry) => {
        entries.push(entry.fileName);
        if (entry.fileName === 'manifest.json') {
          zip.openReadStream(entry, (streamErr, stream) => {
            if (streamErr || !stream) {
              reject(streamErr || new Error('Failed to open manifest.json'));
              return;
            }
            const chunks: Buffer[] = [];
            stream.on('data', (chunk: Buffer) => chunks.push(chunk));
            stream.on('end', () => {
              manifestRaw = Buffer.concat(chunks).toString('utf-8');
              zip.readEntry();
            });
            stream.on('error', reject);
          });
        } else {
          zip.readEntry();
        }
      });
      zip.on('end', () => {
        if (!manifestRaw) {
          reject(new Error('manifest.json missing from archive'));
          return;
        }
        try {
          resolve({ entries, manifest: JSON.parse(manifestRaw) });
        } catch (err) {
          reject(new Error(`Invalid manifest.json: ${(err as Error).message}`));
        }
      });
      zip.on('error', reject);
    });
  });
}

/** SHA-256 of the archive contents as lowercase hex. */
export async function sha256File(filePath: string): Promise<string> {
  const buf = await readFileBuffer(filePath);
  return sha256Hex(buf);
}

/** Read one entry of a .mcpb archive as UTF-8 text. */
export function readArchiveEntry(archivePath: string, entryName: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (err: Error | null, zip: ZipFile | undefined) => {
      if (err || !zip) {
        reject(err || new Error('yauzl returned no handle'));
        return;
      }
      zip.readEntry();
      zip.on('entry', (entry: Entry) => {
        if (entry.fileName !== entryName) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            reject(streamErr || new Error(`Failed to open ${entryName}`));
            return;
          }
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
          stream.on('error', reject);
        });
      });
      zip.on('end', () => reject(new Error(`${entryName} not found in archive`)));
      zip.on('error', reject);
    });
  });
}

/** Extract every file of a .mcpb archive into `destDir`, as an MCPB host does. */
export function extractArchive(archivePath: string, destDir: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (err: Error | null, zip: ZipFile | undefined) => {
      if (err || !zip) {
        reject(err || new Error('yauzl returned no handle'));
        return;
      }
      zip.readEntry();
      zip.on('entry', (entry: Entry) => {
        if (entry.fileName.endsWith('/')) {
          zip.readEntry();
          return;
        }
        const target = path.join(destDir, entry.fileName);
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            reject(streamErr || new Error(`Failed to open ${entry.fileName}`));
            return;
          }
          ensureDir(path.dirname(target))
            .then(() => {
              const output = createWriteStream(target);
              output.on('finish', () => zip.readEntry());
              output.on('error', reject);
              stream.pipe(output);
            })
            .catch(reject);
        });
      });
      zip.on('end', () => resolve());
      zip.on('error', reject);
    });
  });
}
