import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { composeAdapterSetup } from '../../commands/build/adapters';
import {
  buildTargetStatement,
  deploymentHttpPath,
  envDefaultStatements,
  serverBundleBanner,
  serverRuntimeEnv,
} from '../deployment-env';

/** Variables a stand-in "user entry" reports, as the SDK would read them at start-up. */
const REPORTED = [
  'PORT',
  'FRONTMCP_DAEMON_SOCKET',
  'FRONTMCP_CORS_ORIGINS',
  'FRONTMCP_AFFINITY_COOKIE',
  'FRONTMCP_CSP_ENABLED',
  'FRONTMCP_HSTS',
];
const REPORT = `process.stdout.write(JSON.stringify({ target: globalThis.FRONTMCP_BUILD_TARGET ?? null, env: Object.fromEntries(${JSON.stringify(
  REPORTED,
)}.map((k) => [k, process.env[k] ?? null])) }));`;

describe('frontmcp.config run-time defaults (#680)', () => {
  describe('serverRuntimeEnv', () => {
    const server = {
      http: {
        port: 8080,
        socketPath: '/tmp/mcp.sock',
        entryPath: '/mcp',
        cors: { origins: ['https://app.example.com'], credentials: true, maxAge: 600 },
      },
      cookies: { affinity: 'pod', domain: 'example.com', sameSite: 'Lax' as const },
    };

    it('maps server.http and server.cookies to the variables the SDK reads', () => {
      expect(serverRuntimeEnv(server, { listens: true })).toEqual({
        PORT: '8080',
        FRONTMCP_DAEMON_SOCKET: '/tmp/mcp.sock',
        FRONTMCP_CORS_ORIGINS: '["https://app.example.com"]',
        FRONTMCP_CORS_CREDENTIALS: 'true',
        FRONTMCP_CORS_MAX_AGE: '600',
        FRONTMCP_AFFINITY_COOKIE: 'pod',
        FRONTMCP_AFFINITY_COOKIE_DOMAIN: 'example.com',
        FRONTMCP_AFFINITY_COOKIE_SAMESITE: 'Lax',
      });
    });

    it('leaves the listener to the platform on serverless targets', () => {
      const env = serverRuntimeEnv(server, { listens: false });
      expect(env['PORT']).toBeUndefined();
      expect(env['FRONTMCP_DAEMON_SOCKET']).toBeUndefined();
      expect(env['FRONTMCP_CORS_ORIGINS']).toBe('["https://app.example.com"]');
    });

    it('emits no CORS variables without origins (no CORS headers, the SDK default)', () => {
      expect(serverRuntimeEnv({ http: { cors: { origins: [], credentials: true } } }, { listens: true })).toEqual({});
      expect(serverRuntimeEnv(undefined, { listens: true })).toEqual({});
    });
  });

  it('a deployment entryPath wins over transport.http.path', () => {
    expect(deploymentHttpPath({ http: { entryPath: '/deploy' } }, '/transport')).toBe('/deploy');
    expect(deploymentHttpPath({}, '/transport')).toBe('/transport');
    expect(deploymentHttpPath(undefined, undefined)).toBeUndefined();
  });

  it('env defaults never override a variable that is already set', () => {
    const run = new Function('process', envDefaultStatements({ PORT: '8080', HOST_X: 'a' })) as (p: unknown) => void;
    const fakeProcess = { env: { PORT: '9999' } as Record<string, string> };
    run(fakeProcess);
    expect(fakeProcess.env).toEqual({ PORT: '9999', HOST_X: 'a' });
  });

  it('the build target statement keeps a target that is already set', () => {
    const g = {} as { FRONTMCP_BUILD_TARGET?: string };
    new Function('globalThis', buildTargetStatement('node'))(g);
    expect(g.FRONTMCP_BUILD_TARGET).toBe('node');
    new Function('globalThis', buildTargetStatement('sdk'))(g);
    expect(g.FRONTMCP_BUILD_TARGET).toBe('node');
  });

  describe('serverBundleBanner, executed ahead of a stand-in entry', () => {
    let dir: string;
    let env: NodeJS.ProcessEnv;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deployment-env-'));
      env = { ...process.env };
      for (const key of REPORTED) delete env[key];
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    const server = {
      http: { port: 8080, cors: { origins: ['https://app.example.com'] } },
      cookies: { affinity: 'pod' },
      csp: { enabled: true, directives: { 'default-src': "'self'" } },
      headers: { hsts: 'max-age=1' },
    };

    function bundleWith(banner: string): string {
      const file = path.join(dir, 'app.bundle.js');
      fs.writeFileSync(file, `${banner}\n${REPORT}\n`);
      return file;
    }
    const run = (file: string, extraEnv: NodeJS.ProcessEnv = {}) =>
      JSON.parse(execFileSync(process.execPath, [file], { env: { ...env, ...extraEnv } }).toString()) as {
        target: string | null;
        env: Record<string, string | null>;
      };

    it('records the target and applies server, csp and header defaults when run directly', () => {
      const out = run(bundleWith(serverBundleBanner({ target: 'node', server })));
      expect(out.target).toBe('node');
      expect(out.env).toEqual({
        PORT: '8080',
        FRONTMCP_DAEMON_SOCKET: null,
        FRONTMCP_CORS_ORIGINS: '["https://app.example.com"]',
        FRONTMCP_AFFINITY_COOKIE: 'pod',
        FRONTMCP_CSP_ENABLED: 'true',
        FRONTMCP_HSTS: 'max-age=1',
      });
    });

    it('carries deployments[].env as defaults too', () => {
      const out = run(bundleWith(serverBundleBanner({ target: 'node', env: { PORT: '9090' } })));
      expect(out.env['PORT']).toBe('9090');
    });

    it('lets an explicit environment variable win', () => {
      expect(run(bundleWith(serverBundleBanner({ target: 'node', server })), { PORT: '7000' }).env['PORT']).toBe('7000');
    });

    it('changes nothing when the bundle is require()d (schema extraction, the cli binary)', () => {
      const bundle = bundleWith(serverBundleBanner({ target: 'node', server }));
      const host = path.join(dir, 'host.js');
      fs.writeFileSync(host, `require(${JSON.stringify(bundle)});`);
      const out = JSON.parse(execFileSync(process.execPath, [host], { env }).toString());
      expect(out.target).toBeNull();
      expect(out.env['PORT']).toBeNull();
    });

    it('applies unconditionally in a single executable', () => {
      const bundle = bundleWith(serverBundleBanner({ target: 'mcpb', singleExecutable: true }));
      const host = path.join(dir, 'host.js');
      fs.writeFileSync(host, `require(${JSON.stringify(bundle)});`);
      expect(JSON.parse(execFileSync(process.execPath, [host], { env }).toString()).target).toBe('mcpb');
    });
  });

  describe('composeAdapterSetup', () => {
    it('appends the run-time defaults and the build target to the adapter setup', () => {
      const setup = composeAdapterSetup('distributed', { runtimeEnv: { PORT: '8080' } });
      expect(setup).toContain("process.env.FRONTMCP_DEPLOYMENT_MODE = 'distributed'");
      expect(setup).toContain('if (process.env.PORT === undefined) process.env.PORT = "8080";');
      expect(setup?.trimEnd().endsWith(buildTargetStatement('distributed').trimEnd())).toBe(true);
    });

    it('records each serverless target', () => {
      for (const adapter of ['vercel', 'lambda', 'cloudflare'] as const) {
        expect(composeAdapterSetup(adapter, {})).toContain(`|| "${adapter}"`);
      }
    });

    it('has nothing to emit for an adapter without a setup module', () => {
      expect(composeAdapterSetup('node', {})).toBeUndefined();
    });
  });
});
