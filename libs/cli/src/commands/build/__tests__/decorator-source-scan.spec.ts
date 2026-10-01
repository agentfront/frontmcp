import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { readDecoratorStringLiteral, readEntryDecoratorStringLiteral } from '../decorator-source-scan';

const PATH = ['redis', 'provider'] as const;

describe('readDecoratorStringLiteral (#680)', () => {
  it('reads a literal redis.provider', () => {
    const source = `
      import { FrontMcp } from '@frontmcp/sdk';
      import { App } from './app'; // a sibling .ts file the build could not evaluate
      @FrontMcp({
        info: { name: 'x', version: '1.0.0' },
        apps: [App],
        redis: { provider: 'vercel-kv', url: process.env.KV_URL },
      })
      export default class Server {}
    `;
    expect(readDecoratorStringLiteral(source, PATH)).toBe('vercel-kv');
  });

  it('accepts quoted keys, double quotes, `as const` and a plain template literal', () => {
    expect(readDecoratorStringLiteral(`@FrontMcp({ 'redis': { "provider": "vercel-kv" as const } })`, PATH)).toBe(
      'vercel-kv',
    );
    expect(readDecoratorStringLiteral('@FrontMcp({ redis: { provider: `vercel-kv` } })', PATH)).toBe('vercel-kv');
  });

  it('reads the provider after other nested values', () => {
    const source = `@FrontMcp({ http: { cors: { origin: ['a', 'b'] } }, redis: { keyPrefix: 'p:', provider: 'redis', host: 'h' } })`;
    expect(readDecoratorStringLiteral(source, PATH)).toBe('redis');
  });

  it.each([
    ['a variable', `@FrontMcp({ redis: redisConfig })`],
    ['a ternary', `@FrontMcp({ redis: process.env.X ? { provider: 'vercel-kv' } : undefined })`],
    ['a computed provider', `@FrontMcp({ redis: { provider: process.env.PROVIDER } })`],
    ['a provider followed by an expression', `@FrontMcp({ redis: { provider: 'vercel-kv' + suffix } })`],
    ['an interpolated template', '@FrontMcp({ redis: { provider: `${kind}` } })'],
    ['no redis', `@FrontMcp({ info: { name: 'x', version: '1' } })`],
    ['a nested provider only', `@FrontMcp({ tasks: { redis: { provider: 'vercel-kv' } } })`],
    ['no decorator', `export const config = { redis: { provider: 'vercel-kv' } };`],
  ])('answers undefined for %s', (_label, source) => {
    expect(readDecoratorStringLiteral(source, PATH)).toBeUndefined();
  });

  it('ignores commented-out and string look-alikes', () => {
    const source = `
      // @FrontMcp({ redis: { provider: 'vercel-kv' } })
      /* redis: { provider: 'vercel-kv' } */
      const note = "redis: { provider: 'vercel-kv' }";
      @FrontMcp({ redis: { host: 'localhost' } })
      class S {}
    `;
    expect(readDecoratorStringLiteral(source, PATH)).toBeUndefined();
  });

  it('answers undefined for an empty path', () => {
    expect(readDecoratorStringLiteral(`@FrontMcp({ redis: {} })`, [])).toBeUndefined();
  });

  it('reads the entry file, and answers undefined when it is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decorator-scan-'));
    try {
      const entry = path.join(dir, 'main.ts');
      fs.writeFileSync(entry, `@FrontMcp({ redis: { provider: 'vercel-kv' } }) class S {}`);
      expect(readEntryDecoratorStringLiteral(entry, PATH)).toBe('vercel-kv');
      expect(readEntryDecoratorStringLiteral(path.join(dir, 'missing.ts'), PATH)).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
