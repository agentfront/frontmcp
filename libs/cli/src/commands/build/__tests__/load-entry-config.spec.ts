/**
 * Tests for `loadEntryDecoratorInfo` source-AST scanning (#375 round-2).
 *
 * The runtime-evaluated config object misses env-gated branches like
 * `sqlite: process.env.X ? {...} : undefined` (because the ternary
 * evaluates to undefined when X isn't set), but the bundler still ships
 * the Node-only branch in the worker output. The source-level scanner
 * captures the property names regardless of value evaluation.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadEntryDecoratorInfo } from '../load-entry-config';

async function makeEntry(source: string): Promise<{ dir: string; entry: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-entry-'));
  const entry = path.join(dir, 'main.ts');
  await writeFile(entry, source);
  return { dir, entry };
}

describe('loadEntryDecoratorInfo — source-AST scan (#375 round-2)', () => {
  it('captures top-level @FrontMcp keys when values are literal objects', async () => {
    const { dir, entry } = await makeEntry(`
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  http: { port: 3000 },
  sqlite: { path: '~/db.sqlite' },
})
export default class App {}
`);
    try {
      const info = await loadEntryDecoratorInfo(entry);
      expect(info.keysSeenInSource).toEqual(expect.arrayContaining(['http', 'sqlite']));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('captures keys hidden behind env-gated ternaries (the headline #375 case)', async () => {
    const { dir, entry } = await makeEntry(`
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  http: { port: 3000 },
  redis: process.env.REDIS_HOST
    ? { host: process.env.REDIS_HOST, port: parseInt(process.env.REDIS_PORT || '6379', 10) }
    : undefined,
  sqlite: process.env.REDIS_HOST
    ? undefined
    : { path: process.env.FRONTMCP_DB_PATH || '~/.frontegg-bin/data.db' },
})
export default class App {}
`);
    try {
      const info = await loadEntryDecoratorInfo(entry);
      expect(info.keysSeenInSource).toEqual(expect.arrayContaining(['http', 'redis', 'sqlite']));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not false-match on `sqlite:` inside string literals or comments', async () => {
    const { dir, entry } = await makeEntry(`
import { FrontMcp } from '@frontmcp/sdk';

// sqlite: { path: '~/db.sqlite' }   ← this is in a comment, must be ignored
const note = 'redis: not used here';

@FrontMcp({
  http: { port: 3000 },
})
export default class App {}
`);
    try {
      const info = await loadEntryDecoratorInfo(entry);
      expect(info.keysSeenInSource).toEqual(['http']);
      expect(info.keysSeenInSource).not.toContain('sqlite');
      expect(info.keysSeenInSource).not.toContain('redis');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns an empty list when there is no @FrontMcp decorator', async () => {
    const { dir, entry } = await makeEntry(`
export default { name: 'plain-config', deployments: [{ target: 'node' }] };
`);
    try {
      const info = await loadEntryDecoratorInfo(entry);
      expect(info.keysSeenInSource).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('skips nested object keys (only top-level @FrontMcp({...}) keys are captured)', async () => {
    const { dir, entry } = await makeEntry(`
import { FrontMcp } from '@frontmcp/sdk';

@FrontMcp({
  http: { sqlite: 'this-is-a-nested-key' },
  cors: { origin: '*' },
})
export default class App {}
`);
    try {
      const info = await loadEntryDecoratorInfo(entry);
      // sqlite is a nested key inside http: { ... } so it should NOT be reported.
      expect(info.keysSeenInSource).toEqual(expect.arrayContaining(['http', 'cors']));
      expect(info.keysSeenInSource).not.toContain('sqlite');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
