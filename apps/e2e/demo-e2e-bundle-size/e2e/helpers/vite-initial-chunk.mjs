// Builds an entry with Vite and prints the bytes of its initial chunks and of all its chunks: node vite-initial-chunk.mjs <entry> <outDir> <missingPeerStub> <peer>...
import { join } from 'node:path';

import { build } from 'vite';

import { readJSON, stat } from '@frontmcp/utils';

const [entry, outDir, missingPeerStub, ...optionalPeers] = process.argv.slice(2);
const exactly = (name) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`);

await build({
  configFile: false,
  logLevel: 'silent',
  resolve: { alias: optionalPeers.map((peer) => ({ find: exactly(peer), replacement: missingPeerStub })) },
  build: {
    outDir,
    emptyOutDir: true,
    manifest: true,
    minify: true,
    modulePreload: false,
    rollupOptions: { input: entry, preserveEntrySignatures: 'exports-only' },
  },
});

const manifest = await readJSON(join(outDir, '.vite/manifest.json'));
const sizeOf = async (chunk) => (await stat(join(outDir, chunk.file))).size;
const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry);
const initialKeys = new Set();
const collectInitial = (key) => {
  if (initialKeys.has(key)) return;
  initialKeys.add(key);
  for (const imported of manifest[key].imports ?? []) collectInitial(imported);
};
collectInitial(entryKey);

let initialBytes = 0;
let totalBytes = 0;
for (const [key, chunk] of Object.entries(manifest)) {
  if (!chunk.file.endsWith('.js')) continue;
  const bytes = await sizeOf(chunk);
  totalBytes += bytes;
  if (initialKeys.has(key)) initialBytes += bytes;
}
process.stdout.write(JSON.stringify({ initialBytes, totalBytes }));
