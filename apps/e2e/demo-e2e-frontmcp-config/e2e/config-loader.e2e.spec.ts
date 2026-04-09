/**
 * E2E Tests for frontmcp.config file loading.
 * Tests multi-format config loading (JSON, TS).
 */

import os from 'os';
import path from 'path';

import { loadFrontMcpConfig } from '@frontmcp/cli';
import { mkdtemp, rm, writeFile } from '@frontmcp/utils';

describe('frontmcp.config loader (E2E)', () => {
  it('should load JSON config from directory', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-config-'));

    await writeFile(
      path.join(tmpDir, 'frontmcp.config.json'),
      JSON.stringify({ name: 'loaded-server', deployments: [{ target: 'node' }] }),
    );

    const config = await loadFrontMcpConfig(tmpDir);
    expect(config.name).toBe('loaded-server');
    expect(config.deployments[0].target).toBe('node');

    await rm(tmpDir, { recursive: true });
  });

  it('should fall back to package.json when no config file', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-fallback-'));

    await writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: '@test/my-server', version: '3.0.0' }));

    const config = await loadFrontMcpConfig(tmpDir);
    expect(config.name).toBe('my-server'); // Strips scope
    expect(config.deployments[0].target).toBe('node'); // Default

    await rm(tmpDir, { recursive: true });
  });

  it('should throw when no config file and no package.json', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-empty-'));

    await expect(loadFrontMcpConfig(tmpDir)).rejects.toThrow('No frontmcp.config found');

    await rm(tmpDir, { recursive: true });
  });
});
