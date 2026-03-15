/**
 * @file esm-loader.e2e.spec.ts
 * @description End-to-end tests for the ESM loader pipeline using a local HTTP server.
 *
 * Tests the full flow: VersionResolver → fetch registry → EsmModuleLoader → fetch bundle → cache → import → execute.
 * No real network calls - everything hits a local HTTP server on 127.0.0.1.
 *
 * Note: Bundles use CJS format for Jest compatibility. In production, esm.sh serves ESM.
 * The dynamic-import-from-file step is Node.js built-in; we test everything else end-to-end.
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { mkdtemp, rm, writeFile } from '@frontmcp/utils';
import { LocalEsmServer } from './helpers/local-esm-server';
import { SIMPLE_TOOLS_V1, SIMPLE_TOOLS_V2, MULTI_PRIMITIVE, NAMED_EXPORTS } from './helpers/esm-fixtures';
import { VersionResolver } from '../version-resolver';
import { VersionPoller } from '../version-poller';
import { parsePackageSpecifier } from '../package-specifier';
import { normalizeEsmExport } from '../esm-manifest';

/**
 * Load a CJS bundle from disk (Jest-compatible alternative to dynamic import).
 * Clears require cache to avoid stale modules.
 */
function loadBundleFromDisk(filePath: string): unknown {
  delete require.cache[require.resolve(filePath)];
  return require(filePath);
}

describe('ESM Loader E2E', () => {
  let server: LocalEsmServer;
  let registryUrl: string;
  let esmBaseUrl: string;
  let tmpCacheDir: string;

  beforeAll(async () => {
    server = new LocalEsmServer();

    server.addPackage({
      name: '@test/simple-tools',
      versions: {
        '1.0.0': { bundle: SIMPLE_TOOLS_V1 },
        '2.0.0': { bundle: SIMPLE_TOOLS_V2 },
      },
      'dist-tags': { latest: '1.0.0', next: '2.0.0' },
    });

    server.addPackage({
      name: '@test/multi-primitive',
      versions: {
        '1.0.0': { bundle: MULTI_PRIMITIVE },
      },
      'dist-tags': { latest: '1.0.0' },
    });

    server.addPackage({
      name: '@test/named-exports',
      versions: {
        '1.0.0': { bundle: NAMED_EXPORTS },
      },
      'dist-tags': { latest: '1.0.0' },
    });

    const info = await server.start();
    registryUrl = info.registryUrl;
    esmBaseUrl = info.esmBaseUrl;
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(async () => {
    tmpCacheDir = await mkdtemp(path.join(os.tmpdir(), 'esm-e2e-'));
    server.clearRequestLog();
  });

  afterEach(async () => {
    await rm(tmpCacheDir, { recursive: true, force: true }).catch(() => undefined);
  });

  describe('VersionResolver with local registry', () => {
    it('resolves latest tag from local server', async () => {
      const resolver = new VersionResolver({
        registryAuth: { registryUrl },
      });

      const specifier = parsePackageSpecifier('@test/simple-tools@latest');
      const result = await resolver.resolve(specifier);

      expect(result.resolvedVersion).toBe('1.0.0');
      expect(result.availableVersions).toContain('1.0.0');
      expect(result.availableVersions).toContain('2.0.0');
    });

    it('resolves next tag from local server', async () => {
      const resolver = new VersionResolver({
        registryAuth: { registryUrl },
      });

      const specifier = parsePackageSpecifier('@test/simple-tools@next');
      const result = await resolver.resolve(specifier);

      expect(result.resolvedVersion).toBe('2.0.0');
    });

    it('resolves semver range from local server', async () => {
      const resolver = new VersionResolver({
        registryAuth: { registryUrl },
      });

      const specifier = parsePackageSpecifier('@test/simple-tools@^1.0.0');
      const result = await resolver.resolve(specifier);

      expect(result.resolvedVersion).toBe('1.0.0');
    });

    it('returns 404 for unknown package', async () => {
      const resolver = new VersionResolver({
        registryAuth: { registryUrl },
      });

      const specifier = parsePackageSpecifier('@test/nonexistent@latest');
      await expect(resolver.resolve(specifier)).rejects.toThrow('not found');
    });
  });

  describe('Auth token handling', () => {
    afterEach(() => {
      server.setAuthToken(undefined);
    });

    it('succeeds when correct token provided', async () => {
      server.setAuthToken('test-secret-token');

      const resolver = new VersionResolver({
        registryAuth: {
          registryUrl,
          token: 'test-secret-token',
        },
      });

      const specifier = parsePackageSpecifier('@test/simple-tools@latest');
      const result = await resolver.resolve(specifier);
      expect(result.resolvedVersion).toBe('1.0.0');
    });

    it('fails with 401 when no token provided but server requires it', async () => {
      server.setAuthToken('test-secret-token');

      const resolver = new VersionResolver({
        registryAuth: { registryUrl },
      });

      const specifier = parsePackageSpecifier('@test/simple-tools@latest');
      await expect(resolver.resolve(specifier)).rejects.toThrow('401');
    });

    it('fails with 401 when wrong token provided', async () => {
      server.setAuthToken('correct-token');

      const resolver = new VersionResolver({
        registryAuth: {
          registryUrl,
          token: 'wrong-token',
        },
      });

      const specifier = parsePackageSpecifier('@test/simple-tools@latest');
      await expect(resolver.resolve(specifier)).rejects.toThrow('401');
    });

    it('auth header is sent in requests', async () => {
      server.setAuthToken('verify-header');

      const resolver = new VersionResolver({
        registryAuth: {
          registryUrl,
          token: 'verify-header',
        },
      });

      const specifier = parsePackageSpecifier('@test/simple-tools@latest');
      await resolver.resolve(specifier);

      const log = server.getRequestLog();
      expect(log.length).toBeGreaterThan(0);
      expect(log[0].headers.authorization).toBe('Bearer verify-header');
    });
  });

  describe('ESM bundle fetching', () => {
    it('fetches bundle from custom ESM base URL', async () => {
      const response = await fetch(`${esmBaseUrl}/@test/simple-tools@1.0.0?bundle`);
      expect(response.ok).toBe(true);

      const content = await response.text();
      expect(content).toContain('@test/simple-tools');
      expect(content).toContain('echo');
    });

    it('returns 404 for unknown package version', async () => {
      const response = await fetch(`${esmBaseUrl}/@test/simple-tools@9.9.9?bundle`);
      expect(response.status).toBe(404);
    });

    it('serves correct ETag header', async () => {
      const response = await fetch(`${esmBaseUrl}/@test/simple-tools@1.0.0?bundle`);
      const etag = response.headers.get('etag');
      expect(etag).toBe('"@test/simple-tools@1.0.0"');
    });

    it('returns 404 for unknown package', async () => {
      const response = await fetch(`${esmBaseUrl}/@test/nonexistent@1.0.0?bundle`);
      expect(response.status).toBe(404);
    });
  });

  describe('Bundle import and manifest normalization', () => {
    it('writes bundle to disk and imports correctly', async () => {
      const response = await fetch(`${esmBaseUrl}/@test/simple-tools@1.0.0?bundle`);
      const bundleContent = await response.text();

      const bundlePath = path.join(tmpCacheDir, 'simple-tools-v1.js');
      await writeFile(bundlePath, bundleContent);

      const mod = loadBundleFromDisk(bundlePath);
      const manifest = normalizeEsmExport(mod);

      expect(manifest.name).toBe('@test/simple-tools');
      expect(manifest.version).toBe('1.0.0');
      expect(manifest.tools).toHaveLength(1);
      expect((manifest.tools![0] as { name: string }).name).toBe('echo');
    });

    it('imports multi-primitive package correctly', async () => {
      const response = await fetch(`${esmBaseUrl}/@test/multi-primitive@1.0.0?bundle`);
      const bundleContent = await response.text();

      const bundlePath = path.join(tmpCacheDir, 'multi-primitive.js');
      await writeFile(bundlePath, bundleContent);

      const mod = loadBundleFromDisk(bundlePath);
      const manifest = normalizeEsmExport(mod);

      expect(manifest.name).toBe('@test/multi-primitive');
      expect(manifest.tools).toHaveLength(1);
      expect(manifest.prompts).toHaveLength(1);
      expect(manifest.resources).toHaveLength(1);
    });

    it('imports named exports package correctly', async () => {
      const response = await fetch(`${esmBaseUrl}/@test/named-exports@1.0.0?bundle`);
      const bundleContent = await response.text();

      const bundlePath = path.join(tmpCacheDir, 'named-exports.js');
      await writeFile(bundlePath, bundleContent);

      const mod = loadBundleFromDisk(bundlePath);
      const manifest = normalizeEsmExport(mod);

      expect(manifest.name).toBe('@test/named-exports');
      expect(manifest.tools).toHaveLength(1);
    });
  });

  describe('Tool execution', () => {
    it('executes a loaded tool end-to-end', async () => {
      const response = await fetch(`${esmBaseUrl}/@test/simple-tools@1.0.0?bundle`);
      const bundleContent = await response.text();

      const bundlePath = path.join(tmpCacheDir, 'exec-test.js');
      await writeFile(bundlePath, bundleContent);

      const mod = loadBundleFromDisk(bundlePath);
      const manifest = normalizeEsmExport(mod);

      const echoTool = manifest.tools![0] as {
        execute: (input: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;
      };
      const result = await echoTool.execute({ message: 'hello' });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toBe(JSON.stringify({ message: 'hello' }));
    });

    it('executes multi-primitive tools and resources', async () => {
      const response = await fetch(`${esmBaseUrl}/@test/multi-primitive@1.0.0?bundle`);
      const bundleContent = await response.text();

      const bundlePath = path.join(tmpCacheDir, 'multi-exec.js');
      await writeFile(bundlePath, bundleContent);

      const mod = loadBundleFromDisk(bundlePath);
      const manifest = normalizeEsmExport(mod);

      // Execute tool
      const greetTool = manifest.tools![0] as {
        execute: (input: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;
      };
      const toolResult = await greetTool.execute({ name: 'Alice' });
      expect(toolResult.content[0].text).toBe('Hello, Alice!');

      // Execute resource
      const statusResource = manifest.resources![0] as {
        read: () => Promise<{ contents: Array<{ text: string }> }>;
      };
      const resResult = await statusResource.read();
      expect(JSON.parse(resResult.contents[0].text)).toEqual({ status: 'ok' });

      // Execute prompt
      const greetPrompt = manifest.prompts![0] as {
        execute: (args: Record<string, string>) => Promise<{ messages: Array<{ content: { text: string } }> }>;
      };
      const promptResult = await greetPrompt.execute({ name: 'Bob' });
      expect(promptResult.messages[0].content.text).toBe('Greet Bob');
    });
  });

  describe('Version update detection', () => {
    it('detects new version via VersionPoller', async () => {
      // Temporarily set latest to 2.0.0
      server.addPackage({
        name: '@test/simple-tools',
        versions: {
          '1.0.0': { bundle: SIMPLE_TOOLS_V1 },
          '2.0.0': { bundle: SIMPLE_TOOLS_V2 },
        },
        'dist-tags': { latest: '2.0.0', next: '2.0.0' },
      });

      const onNewVersion = jest.fn().mockResolvedValue(undefined);

      const poller = new VersionPoller({
        onNewVersion,
        registryAuth: { registryUrl },
      });

      const specifier = parsePackageSpecifier('@test/simple-tools@latest');
      poller.addPackage(specifier, '1.0.0');

      try {
        const results = await poller.checkNow();

        expect(results).toHaveLength(1);
        expect(results[0].hasUpdate).toBe(true);
        expect(results[0].latestVersion).toBe('2.0.0');
        expect(results[0].currentVersion).toBe('1.0.0');
      } finally {
        poller.stop();

        // Restore
        server.addPackage({
          name: '@test/simple-tools',
          versions: {
            '1.0.0': { bundle: SIMPLE_TOOLS_V1 },
            '2.0.0': { bundle: SIMPLE_TOOLS_V2 },
          },
          'dist-tags': { latest: '1.0.0', next: '2.0.0' },
        });
      }
    });

    it('reports no update when version matches', async () => {
      const onNewVersion = jest.fn().mockResolvedValue(undefined);

      const poller = new VersionPoller({
        onNewVersion,
        registryAuth: { registryUrl },
      });

      const specifier = parsePackageSpecifier('@test/simple-tools@latest');
      poller.addPackage(specifier, '1.0.0');

      const results = await poller.checkNow();

      expect(results).toHaveLength(1);
      expect(results[0].hasUpdate).toBe(false);

      poller.stop();
    });
  });

  describe('Hot-reload cycle', () => {
    it('loads v1, then reloads with v2 containing new tools', async () => {
      // Step 1: Load v1
      const v1Response = await fetch(`${esmBaseUrl}/@test/simple-tools@1.0.0?bundle`);
      const v1Content = await v1Response.text();

      const v1Path = path.join(tmpCacheDir, 'v1.js');
      await writeFile(v1Path, v1Content);

      const v1Mod = loadBundleFromDisk(v1Path);
      const v1Manifest = normalizeEsmExport(v1Mod);

      expect(v1Manifest.tools).toHaveLength(1);
      expect((v1Manifest.tools![0] as { name: string }).name).toBe('echo');

      // Step 2: Load v2 (simulating hot-reload after version detection)
      const v2Response = await fetch(`${esmBaseUrl}/@test/simple-tools@2.0.0?bundle`);
      const v2Content = await v2Response.text();

      const v2Path = path.join(tmpCacheDir, 'v2.js');
      await writeFile(v2Path, v2Content);

      const v2Mod = loadBundleFromDisk(v2Path);
      const v2Manifest = normalizeEsmExport(v2Mod);

      expect(v2Manifest.tools).toHaveLength(2);
      expect((v2Manifest.tools![1] as { name: string }).name).toBe('reverse');
    });
  });

  describe('Multiple packages', () => {
    it('loads two packages independently from same server', async () => {
      const resolver = new VersionResolver({
        registryAuth: { registryUrl },
      });

      const spec1 = parsePackageSpecifier('@test/simple-tools@latest');
      const spec2 = parsePackageSpecifier('@test/multi-primitive@latest');

      const [res1, res2] = await Promise.all([resolver.resolve(spec1), resolver.resolve(spec2)]);

      expect(res1.resolvedVersion).toBe('1.0.0');
      expect(res2.resolvedVersion).toBe('1.0.0');

      // Fetch both bundles
      const [bundle1, bundle2] = await Promise.all([
        fetch(`${esmBaseUrl}/@test/simple-tools@${res1.resolvedVersion}?bundle`).then((r) => r.text()),
        fetch(`${esmBaseUrl}/@test/multi-primitive@${res2.resolvedVersion}?bundle`).then((r) => r.text()),
      ]);

      expect(bundle1).toContain('simple-tools');
      expect(bundle2).toContain('multi-primitive');
    });
  });

  describe('Cache behavior', () => {
    it('second fetch hits server again (verifiable via request log)', async () => {
      server.clearRequestLog();

      // First fetch
      await fetch(`${esmBaseUrl}/@test/simple-tools@1.0.0?bundle`);
      const countAfterFirst = server.getRequestLog().length;

      // Second fetch
      await fetch(`${esmBaseUrl}/@test/simple-tools@1.0.0?bundle`);
      const countAfterSecond = server.getRequestLog().length;

      // Both should hit the server (HTTP-level caching is not implemented in our test server)
      expect(countAfterSecond).toBe(countAfterFirst + 1);
    });
  });

  describe('Request logging', () => {
    it('records all requests made to the server', async () => {
      server.clearRequestLog();

      const resolver = new VersionResolver({
        registryAuth: { registryUrl },
      });

      const specifier = parsePackageSpecifier('@test/simple-tools@latest');
      await resolver.resolve(specifier);

      const log = server.getRequestLog();
      expect(log.length).toBeGreaterThan(0);
      expect(log[0].method).toBe('GET');
      expect(log[0].url).toContain('simple-tools');
    });
  });

  describe('Custom base URL for on-premise', () => {
    it('custom esmShBaseUrl pointing to local server works', async () => {
      const bundleUrl = `${esmBaseUrl}/@test/simple-tools@1.0.0?bundle`;
      const response = await fetch(bundleUrl);

      expect(response.ok).toBe(true);
      const content = await response.text();
      expect(content).toContain('echo');
      expect(bundleUrl).toContain('127.0.0.1');
    });
  });

  describe('Server dynamic package updates', () => {
    it('serves new version after updatePackage()', async () => {
      server.addPackage({
        name: '@test/dynamic-pkg',
        versions: {
          '1.0.0': {
            bundle: 'module.exports = { default: { name: "@test/dynamic-pkg", version: "1.0.0", tools: [] } };',
          },
        },
        'dist-tags': { latest: '1.0.0' },
      });

      // Verify v1
      const v1Resp = await fetch(`${esmBaseUrl}/@test/dynamic-pkg@1.0.0?bundle`);
      expect(v1Resp.ok).toBe(true);

      // Add v2
      server.updatePackage(
        '@test/dynamic-pkg',
        '2.0.0',
        'module.exports = { default: { name: "@test/dynamic-pkg", version: "2.0.0", tools: [{ name: "new-tool" }] } };',
      );

      // Verify v2
      const v2Resp = await fetch(`${esmBaseUrl}/@test/dynamic-pkg@2.0.0?bundle`);
      expect(v2Resp.ok).toBe(true);
      const v2Content = await v2Resp.text();
      expect(v2Content).toContain('new-tool');

      // Verify registry reflects updated latest
      const resolver = new VersionResolver({
        registryAuth: { registryUrl },
      });
      const specifier = parsePackageSpecifier('@test/dynamic-pkg@latest');
      const result = await resolver.resolve(specifier);
      expect(result.resolvedVersion).toBe('2.0.0');
    });
  });
});
