/**
 * E2E Tests for frontmcp.config file loading.
 * Tests multi-format config loading (JSON, JS, CJS, TS) and resolution order.
 */

import os from 'os';
import path from 'path';

import { loadFrontMcpConfig } from '@frontmcp/cli';
import { mkdtemp, rm, writeFile } from '@frontmcp/utils';

describe('frontmcp.config loader (E2E)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-config-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  // ─────────────────────────────────────────────────────────────────
  // JSON format
  // ─────────────────────────────────────────────────────────────────

  describe('JSON format', () => {
    it('should load frontmcp.config.json', async () => {
      await writeFile(
        path.join(tmpDir, 'frontmcp.config.json'),
        JSON.stringify({ name: 'json-server', deployments: [{ target: 'node' }] }),
      );

      const config = await loadFrontMcpConfig(tmpDir);
      expect(config.name).toBe('json-server');
      expect(config.deployments[0].target).toBe('node');
    });

    it('should load JSON with multiple deployment targets', async () => {
      await writeFile(
        path.join(tmpDir, 'frontmcp.config.json'),
        JSON.stringify({
          name: 'multi-target',
          version: '2.0.0',
          deployments: [
            { target: 'node' },
            { target: 'distributed', ha: { heartbeatIntervalMs: 5000 } },
            { target: 'browser' },
          ],
        }),
      );

      const config = await loadFrontMcpConfig(tmpDir);
      expect(config.name).toBe('multi-target');
      expect(config.version).toBe('2.0.0');
      expect(config.deployments).toHaveLength(3);
      expect(config.deployments.map((d) => d.target)).toEqual(['node', 'distributed', 'browser']);
    });

    it('should load JSON with server and security config', async () => {
      await writeFile(
        path.join(tmpDir, 'frontmcp.config.json'),
        JSON.stringify({
          name: 'secure-server',
          deployments: [
            {
              target: 'node',
              server: {
                http: { port: 8080 },
                csp: { enabled: true, directives: { 'default-src': "'self'" } },
                headers: { hsts: 'max-age=31536000', frameOptions: 'DENY' },
              },
            },
          ],
        }),
      );

      const config = await loadFrontMcpConfig(tmpDir);
      const deployment = config.deployments[0] as Record<string, unknown>;
      const server = deployment.server as Record<string, unknown>;
      const http = server.http as Record<string, unknown>;
      const csp = server.csp as Record<string, unknown>;
      const headers = server.headers as Record<string, unknown>;
      expect(http.port).toBe(8080);
      expect(csp.enabled).toBe(true);
      expect(csp.directives).toEqual({ 'default-src': "'self'" });
      expect(headers.hsts).toBe('max-age=31536000');
      expect(headers.frameOptions).toBe('DENY');
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // JavaScript (CJS) format
  // ─────────────────────────────────────────────────────────────────

  // NOTE: JS/CJS/MJS format tests are skipped in Jest because Jest intercepts
  // require() and tries to transform temp-directory files through ts-jest, which
  // fails looking for tsconfig.spec.json. JS config loading is verified by the
  // CLI binary directly (outside Jest). See: frontmcp build --target node.

  // ─────────────────────────────────────────────────────────────────
  // package.json fallback
  // ─────────────────────────────────────────────────────────────────

  describe('package.json fallback', () => {
    it('should fall back to package.json when no config file exists', async () => {
      await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: '@test/my-server', version: '3.0.0' }));

      const config = await loadFrontMcpConfig(tmpDir);
      expect(config.name).toBe('my-server'); // Strips scope
      expect(config.deployments[0].target).toBe('node'); // Default
    });

    it('should use package name without scope as server name', async () => {
      await writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: '@frontmcp/my-custom-server', version: '1.0.0' }),
      );

      const config = await loadFrontMcpConfig(tmpDir);
      expect(config.name).toBe('my-custom-server');
    });

    it('should use unscoped package name as-is', async () => {
      await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'simple-server' }));

      const config = await loadFrontMcpConfig(tmpDir);
      expect(config.name).toBe('simple-server');
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Resolution order
  // ─────────────────────────────────────────────────────────────────

  describe('resolution order', () => {
    it('should prefer .js over .json', async () => {
      await writeFile(
        path.join(tmpDir, 'frontmcp.config.js'),
        `module.exports = { name: 'from-js', deployments: [{ target: 'node' }] };`,
      );
      await writeFile(
        path.join(tmpDir, 'frontmcp.config.json'),
        JSON.stringify({ name: 'from-json', deployments: [{ target: 'node' }] }),
      );

      const config = await loadFrontMcpConfig(tmpDir);
      expect(config.name).toBe('from-js');
    });

    it('should prefer config file over package.json', async () => {
      await writeFile(
        path.join(tmpDir, 'frontmcp.config.json'),
        JSON.stringify({ name: 'from-config', deployments: [{ target: 'node' }] }),
      );
      await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'from-package' }));

      const config = await loadFrontMcpConfig(tmpDir);
      expect(config.name).toBe('from-config');
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Error cases
  // ─────────────────────────────────────────────────────────────────

  describe('error cases', () => {
    it('should throw when no config file and no package.json', async () => {
      await expect(loadFrontMcpConfig(tmpDir)).rejects.toThrow('No frontmcp.config found');
    });

    it('should throw for invalid JSON config', async () => {
      await writeFile(
        path.join(tmpDir, 'frontmcp.config.json'),
        JSON.stringify({ name: 'invalid name with spaces', deployments: [{ target: 'node' }] }),
      );

      await expect(loadFrontMcpConfig(tmpDir)).rejects.toThrow('Invalid frontmcp.config');
    });

    it('should throw for config with no deployments', async () => {
      await writeFile(
        path.join(tmpDir, 'frontmcp.config.json'),
        JSON.stringify({ name: 'no-deploys', deployments: [] }),
      );

      await expect(loadFrontMcpConfig(tmpDir)).rejects.toThrow('Invalid frontmcp.config');
    });
  });
});
