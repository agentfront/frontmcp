import * as os from 'os';
import * as path from 'path';

import { ensureDir, mkdtemp, readFile, rm, writeFile } from '@frontmcp/utils';

import { bundleForServerless, externalizeOptionalPackages } from '../bundler';

function run(
  fn: ReturnType<typeof externalizeOptionalPackages>,
  request: string | undefined,
  context?: string,
): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    fn({ request, context }, (err, r) => (err ? reject(err) : resolve(r)));
  });
}

describe('externalizeOptionalPackages (#642)', () => {
  const fn = externalizeOptionalPackages(os.tmpdir());

  it('always externalizes native addons', async () => {
    expect(await run(fn, 'better-sqlite3')).toBe('commonjs better-sqlite3');
  });

  it('externalizes an optional package that is not installed, including subpaths', async () => {
    expect(await run(fn, '@frontmcp/observability', os.tmpdir())).toBe('commonjs @frontmcp/observability');
    expect(await run(fn, '@vercel/kv/foo', os.tmpdir())).toBe('commonjs @vercel/kv/foo');
  });

  it('leaves unrelated requests to the bundler', async () => {
    expect(await run(fn, 'express')).toBeUndefined();
    expect(await run(fn, './local', '/x')).toBeUndefined();
    expect(await run(fn, undefined)).toBeUndefined();
  });

  it('bundles an optional package when it is installed', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-ext-'));
    try {
      const pkg = path.join(dir, 'node_modules', '@vercel', 'kv');
      await ensureDir(pkg);
      await writeFile(path.join(pkg, 'package.json'), '{"name":"@vercel/kv","version":"0.0.0","main":"index.js"}');
      await writeFile(path.join(pkg, 'index.js'), 'exports.kv = {};');
      expect(await run(externalizeOptionalPackages(dir), '@vercel/kv', dir)).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('bundleForServerless (#642)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-rspack-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('bundles a project that lacks the optional runtime packages and keeps NODE_ENV dynamic', async () => {
    const entry = path.join(dir, 'index.js');
    await writeFile(
      entry,
      `function optional() {
  try { return require('@frontmcp/storage-sqlite'); } catch { return undefined; }
}
function kv() {
  try { return require('@vercel/kv'); } catch { return undefined; }
}
function obs() {
  try { return require('@frontmcp/observability') && require('@opentelemetry/sdk-trace-base'); } catch { return undefined; }
}
function sqlite() {
  try { return require('better-sqlite3'); } catch { return undefined; }
}
module.exports = { env: () => process.env.NODE_ENV, optional, kv, obs, sqlite };
`,
    );

    await bundleForServerless(entry, dir, 'handler.cjs');

    const bundle = await readFile(path.join(dir, 'handler.cjs'));
    expect(bundle).toContain('process.env.NODE_ENV');
    expect(bundle).not.toMatch(/env:\s*\(\)\s*=>\s*"production"/);
    for (const pkg of ['@frontmcp/storage-sqlite', '@vercel/kv', '@frontmcp/observability', 'better-sqlite3']) {
      expect(bundle).toContain(`require("${pkg}")`);
    }

    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
       
      const mod = require(path.join(dir, 'handler.cjs')) as { env: () => string };
      expect(mod.env()).toBe('development');
    } finally {
      process.env.NODE_ENV = prev;
    }
  }, 60000);
});

describe('bundleForServerless: Lambda adapter (#680)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-lambda-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('inlines an installed @codegenie/serverless-express, so dist/lambda runs without node_modules', async () => {
    const pkg = path.join(dir, 'node_modules', '@codegenie', 'serverless-express');
    await ensureDir(pkg);
    await writeFile(
      path.join(pkg, 'package.json'),
      '{"name":"@codegenie/serverless-express","version":"5.0.0","main":"index.js"}',
    );
    await writeFile(path.join(pkg, 'index.js'), "module.exports = () => () => 'adapted';");

    const out = path.join(dir, 'dist');
    await ensureDir(out);
    const entry = path.join(out, 'index.js');
    await writeFile(
      entry,
      `const serverlessExpress = require('@codegenie/serverless-express');
exports.handler = serverlessExpress({ app: {} });
`,
    );

    const cwd = process.cwd();
    process.chdir(dir);
    try {
      await bundleForServerless(entry, out, 'handler.cjs');
    } finally {
      process.chdir(cwd);
    }

    const bundle = await readFile(path.join(out, 'handler.cjs'));
    expect(bundle).not.toContain('require("@codegenie/serverless-express")');

    // The deployed folder has no node_modules: the handler must load from the bundle alone.
    await rm(path.join(dir, 'node_modules'), { recursive: true, force: true });
    const mod = require(path.join(out, 'handler.cjs')) as { handler: () => string };
    expect(mod.handler()).toBe('adapted');
  }, 60000);
});
