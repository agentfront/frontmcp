import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { generateServerBundleBanner } from '../server-bundle-banner';

const REPORT = 'process.stdout.write(JSON.stringify({ stdio: process.env.FRONTMCP_STDIO ?? null, path: process.env.FRONTMCP_HTTP_ENTRY_PATH ?? null }));';

describe('generateServerBundleBanner (#680)', () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-banner-'));
    env = { ...process.env };
    delete env['FRONTMCP_HTTP_ENTRY_PATH'];
    delete env['FRONTMCP_STDIO'];
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A stand-in bundle: the banner, then a module that reports what the decorator would read. */
  function writeBundle(banner: string): string {
    const bundle = path.join(dir, 'demo.bundle.js');
    fs.writeFileSync(bundle, `${banner}\n${REPORT}\n`);
    return bundle;
  }

  const run = (bundle: string, args: string[] = [], extraEnv: NodeJS.ProcessEnv = {}) =>
    JSON.parse(execFileSync(process.execPath, [bundle, ...args], { env: { ...env, ...extraEnv } }).toString()) as {
      stdio: string | null;
      path: string | null;
    };

  it('serves transport.http.path when the bundle is run directly', () => {
    const bundle = writeBundle(generateServerBundleBanner({ httpEntryPath: '/mcp' }, { mainOnly: true }));
    expect(run(bundle)).toEqual({ stdio: null, path: '/mcp' });
  });

  it('lets an explicit FRONTMCP_HTTP_ENTRY_PATH win', () => {
    const bundle = writeBundle(generateServerBundleBanner({ httpEntryPath: '/mcp' }, { mainOnly: true }));
    expect(run(bundle, [], { FRONTMCP_HTTP_ENTRY_PATH: '/custom' }).path).toBe('/custom');
  });

  it('turns --stdio into FRONTMCP_STDIO=1', () => {
    const bundle = writeBundle(generateServerBundleBanner({}, { mainOnly: true }));
    expect(run(bundle, ['--stdio'])).toEqual({ stdio: '1', path: null });
    expect(run(bundle).stdio).toBeNull();
  });

  it('leaves the environment alone when the bundle is require()d (schema extraction, the CLI bundle)', () => {
    const bundle = writeBundle(generateServerBundleBanner({ httpEntryPath: '/mcp' }, { mainOnly: true }));
    const host = path.join(dir, 'host.js');
    fs.writeFileSync(host, `require(${JSON.stringify(bundle)});`);
    expect(JSON.parse(execFileSync(process.execPath, [host, '--stdio'], { env }).toString())).toEqual({
      stdio: null,
      path: null,
    });
  });

  it('applies unconditionally for a single executable', () => {
    const banner = generateServerBundleBanner({ httpEntryPath: '/mcp' }, { mainOnly: false });
    expect(banner).not.toContain('require.main');
    const bundle = writeBundle(banner);
    const host = path.join(dir, 'host.js');
    fs.writeFileSync(host, `require(${JSON.stringify(bundle)});`);
    expect(JSON.parse(execFileSync(process.execPath, [host], { env }).toString()).path).toBe('/mcp');
  });

  it('keeps the bundle in strict mode', () => {
    const bundle = writeBundle(generateServerBundleBanner({}, { mainOnly: true }));
    fs.appendFileSync(bundle, 'process.stdout.write("|" + String((function () { return this; })() === undefined));');
    expect(execFileSync(process.execPath, [bundle], { env }).toString()).toMatch(/\|true$/);
  });

  it('embeds the path as a string literal, so it cannot break out of the code', () => {
    const banner = generateServerBundleBanner({ httpEntryPath: '/a"; process.exit(9); "' }, { mainOnly: true });
    const bundle = writeBundle(banner);
    expect(run(bundle).path).toBe('/a"; process.exit(9); "');
  });
});
