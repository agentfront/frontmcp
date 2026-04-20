import * as fs from 'fs';

import type { Entry, ZipFile } from 'yauzl';

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
        resolve({ entries, manifest: JSON.parse(manifestRaw) });
      });
      zip.on('error', reject);
    });
  });
}

/** SHA-256 of the archive contents as lowercase hex. */
export async function sha256File(filePath: string): Promise<string> {
  const { createHash } = await import('crypto');
  const buf = fs.readFileSync(filePath);
  return createHash('sha256').update(buf).digest('hex');
}
