/**
 * The browser build answers "which NODE_ENV?" from one source (#770): `isProduction()`,
 * `isDevelopment()` and the runtime context's `env` used to disagree, so a browser page saw
 * `env: 'production'` while errors were formatted for development.
 */
import * as path from 'path';

import { getNodeEnv, isDevelopment, isProduction } from '../browser-env';
import { getRuntimeContext, resetRuntimeContext } from '../browser-runtime-context';

type BrowserEnvModule = { getNodeEnv: () => string | undefined; isProduction: () => boolean };

function loadBundledBrowserEnv(options: { define?: string; shimNodeEnv?: string }): BrowserEnvModule {
  const esbuild = require('esbuild') as typeof import('esbuild');
  const result = esbuild.buildSync({
    entryPoints: [path.resolve(__dirname, '../browser-env.ts')],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'neutral',
    define: options.define === undefined ? {} : { 'process.env.NODE_ENV': JSON.stringify(options.define) },
    logLevel: 'silent',
  });
  const fakeGlobal = options.shimNodeEnv === undefined ? {} : { process: { env: { NODE_ENV: options.shimNodeEnv } } };
  const module = { exports: {} as BrowserEnvModule };
  new Function('module', 'exports', 'process', 'globalThis', result.outputFiles[0].text)(
    module,
    module.exports,
    undefined,
    fakeGlobal,
  );
  return module.exports;
}

describe('browser NODE_ENV (#770)', () => {
  const originalNodeEnv = process.env['NODE_ENV'];

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = originalNodeEnv;
    resetRuntimeContext();
  });

  it('reports production everywhere when the page says production', () => {
    process.env['NODE_ENV'] = 'production';

    expect(getNodeEnv()).toBe('production');
    expect(isProduction()).toBe(true);
    expect(isDevelopment()).toBe(false);
    expect(getRuntimeContext().env).toBe('production');
  });

  it('reports development everywhere when the page says development', () => {
    process.env['NODE_ENV'] = 'development';

    expect(isProduction()).toBe(false);
    expect(isDevelopment()).toBe(true);
    expect(getRuntimeContext().env).toBe('development');
  });

  it('defaults the runtime context to development, as on Node, when no NODE_ENV is set', () => {
    delete process.env['NODE_ENV'];

    expect(getNodeEnv()).toBeUndefined();
    expect(isProduction()).toBe(false);
    expect(isDevelopment()).toBe(false);
    expect(getRuntimeContext().env).toBe('development');
  });

  it('follows a NODE_ENV change after the context was first read', () => {
    process.env['NODE_ENV'] = 'development';
    const context = getRuntimeContext();

    process.env['NODE_ENV'] = 'production';

    expect(context.env).toBe('production');
  });

  it('reads the value a bundler inlined when the page has no process', () => {
    const bundled = loadBundledBrowserEnv({ define: 'production' });

    expect(bundled.getNodeEnv()).toBe('production');
    expect(bundled.isProduction()).toBe(true);
  });

  it("prefers a process shim's live value over the inlined one", () => {
    expect(loadBundledBrowserEnv({ define: 'production', shimNodeEnv: 'development' }).getNodeEnv()).toBe(
      'development',
    );
  });

  it('reports no NODE_ENV, without throwing, when the page has neither', () => {
    const bundled = loadBundledBrowserEnv({});

    expect(bundled.getNodeEnv()).toBeUndefined();
    expect(bundled.isProduction()).toBe(false);
  });
});
