/**
 * E2E: an ES-module project ("type": "module") compiles `.tsx` UI on the built packages (#681).
 *
 * Node loads the packages' ESM bundles in such a project. @frontmcp/uipack's ESM bundle had no
 * createRequire banner, so its lazy `require('path')` threw "Dynamic require of "path" is not
 * supported": a tool with `ui: { template: { file } }` returned no widget, and a custom
 * `auth.ui` login page fell back to the built-in one. The server (`fixture/esm-project/server.mjs`)
 * runs with plain `node` in a temporary project that installs the built packages.
 */
import { McpTestClient, TestServer } from '@frontmcp/testing';
import { rm } from '@frontmcp/utils';

import { createEsmProject } from './helpers/esm-project';

const FRONTMCP_PACKAGES = ['sdk', 'uipack', 'ui', 'utils', 'protocol', 'di', 'lazy-zod', 'auth', 'guard'];
const THIRD_PARTY = ['reflect-metadata', 'zod', 'react', 'react-dom'];
const DYNAMIC_REQUIRE = /Dynamic require of/;

let projectDir: string;

async function startServer(env: Record<string, string> = {}): Promise<TestServer> {
  return TestServer.start({
    command: 'node server.mjs',
    cwd: projectDir,
    project: 'demo-e2e-esm',
    env,
    startupTimeout: 60000,
  });
}

describe('ES-module project: .tsx UI on the built packages', () => {
  beforeAll(async () => {
    projectDir = await createEsmProject({ frontmcpPackages: FRONTMCP_PACKAGES, thirdParty: THIRD_PARTY });
  });

  afterAll(async () => {
    if (projectDir) await rm(projectDir, { recursive: true, force: true });
  });

  it('returns the bundled .tsx widget for a tool call', async () => {
    const server = await startServer();
    try {
      const client = await McpTestClient.create({ baseUrl: server.info.baseUrl }).buildAndConnect();
      try {
        const result = await client.tools.call('greet', { name: 'Ada' });

        expect(result.isSuccess).toBe(true);
        const html = (result.raw._meta as Record<string, unknown> | undefined)?.['ui/html'];
        expect(typeof html).toBe('string');
        expect(html as string).toContain('esm-greeting');
      } finally {
        await client.disconnect();
      }
      expect(server.getLogs().filter((line) => DYNAMIC_REQUIRE.test(line))).toEqual([]);
    } finally {
      await server.stop();
    }
  }, 120000);

  it('serves the custom auth.ui login page', async () => {
    const server = await startServer({ AUTH: '1' });
    try {
      const url = new URL(`${server.info.baseUrl}/oauth/authorize`);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', 'esm-client');
      url.searchParams.set('redirect_uri', 'http://127.0.0.1:9876/callback');
      url.searchParams.set('code_challenge', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
      url.searchParams.set('code_challenge_method', 'S256');
      url.searchParams.set('scope', 'read');

      const response = await fetch(url, { redirect: 'manual' });
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain('esm-login-root');
      const logs = server.getLogs();
      expect(logs.filter((line) => DYNAMIC_REQUIRE.test(line))).toEqual([]);
      expect(logs.filter((line) => line.includes('Failed to build auth.ui page'))).toEqual([]);
    } finally {
      await server.stop();
    }
  }, 120000);
});
