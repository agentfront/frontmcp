/**
 * `getNodeEnv()` under a bundler that inlines `process.env.NODE_ENV` (#680).
 *
 * `wrangler dev` builds the worker with esbuild and `define: { 'process.env.NODE_ENV': '"development"' }`,
 * so a `[vars] NODE_ENV = "production"` never reached code reading `process.env.NODE_ENV`. The bundle
 * here is built the same way, then run with the deployment's NODE_ENV.
 */
import * as path from 'path';

import { getNodeEnv } from '../node-env';

type NodeEnvModule = { getNodeEnv: () => string | undefined; isProduction: () => boolean };

function bundleWithDefine(nodeEnvAtBuild: string): (runtimeNodeEnv: string | undefined) => NodeEnvModule {
  const esbuild = require('esbuild') as typeof import('esbuild');
  const result = esbuild.buildSync({
    entryPoints: [path.resolve(__dirname, '../node-env.ts')],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'neutral',
    define: { 'process.env.NODE_ENV': JSON.stringify(nodeEnvAtBuild) },
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  return (runtimeNodeEnv) => {
    const env: Record<string, string | undefined> = runtimeNodeEnv === undefined ? {} : { NODE_ENV: runtimeNodeEnv };
    const module = { exports: {} as NodeEnvModule };
    new Function('module', 'exports', 'process', code)(module, module.exports, { env });
    return module.exports;
  };
}

describe('getNodeEnv under a bundler define (#680)', () => {
  it('the bundle really inlines the literal member expression', () => {
    const esbuild = require('esbuild') as typeof import('esbuild');
    const out = esbuild.transformSync("const a = process.env['NODE_ENV'];", {
      define: { 'process.env.NODE_ENV': '"development"' },
    }).code;
    expect(out).toContain('"development"');
  });

  it('reports the deployment value over the one inlined at build time', () => {
    const load = bundleWithDefine('development');
    expect(load('production').getNodeEnv()).toBe('production');
    expect(load('production').isProduction()).toBe(true);
  });

  it('falls back to the build-time value when the deployment sets none', () => {
    expect(bundleWithDefine('development')(undefined).getNodeEnv()).toBe('development');
    expect(bundleWithDefine('production')(undefined).isProduction()).toBe(true);
  });

  it('reads the live value unbundled', () => {
    const original = process.env['NODE_ENV'];
    try {
      process.env['NODE_ENV'] = 'staging';
      expect(getNodeEnv()).toBe('staging');
      delete process.env['NODE_ENV'];
      expect(getNodeEnv()).toBeUndefined();
    } finally {
      if (original === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = original;
    }
  });
});
