/**
 * `@vercel/kv` and `@upstash/redis` are loaded with a literal dynamic `import()` everywhere (#711).
 * In an ESM build a lazy `require()` is a `createRequire` call that wrangler cannot bundle, so the
 * module was missing on Cloudflare Workers even when installed.
 */
import * as path from 'path';

import { readdir, readFile, stat } from '../../fs';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const SOURCE_ROOTS = ['libs', 'plugins'];
const LAZY_REQUIRE = /require\(\s*['"](@vercel\/kv|@upstash\/redis)['"]\s*\)/;

async function sourceFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__' || entry.startsWith('.')) continue;
    const fullPath = path.join(dir, entry);
    if ((await stat(fullPath)).isDirectory()) files.push(...(await sourceFiles(fullPath)));
    else if (/\.tsx?$/.test(entry) && !/\.spec\.tsx?$/.test(entry)) files.push(fullPath);
  }
  return files;
}

describe('REST storage clients are loaded with import()', () => {
  it('no library or plugin source loads @vercel/kv or @upstash/redis with require()', async () => {
    const offenders: string[] = [];
    for (const root of SOURCE_ROOTS) {
      for (const file of await sourceFiles(path.join(REPO_ROOT, root))) {
        const codeLines = (await readFile(file)).split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
        if (codeLines.some((line) => LAZY_REQUIRE.test(line))) offenders.push(path.relative(REPO_ROOT, file));
      }
    }

    expect(offenders).toEqual([]);
  }, 60_000);
});
