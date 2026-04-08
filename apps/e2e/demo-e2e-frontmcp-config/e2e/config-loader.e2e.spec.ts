/**
 * E2E Tests for frontmcp.config file loading.
 * Tests multi-format config loading (JSON, TS).
 */

import { join } from 'path';

import { loadFrontMcpConfig } from '@frontmcp/cli';

const FIXTURES = join(__dirname, '..', 'fixtures');

describe('frontmcp.config loader (E2E)', () => {
  it('should load JSON config from directory', async () => {
    // Create a temp dir with a frontmcp.config.json
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-config-'));

    fs.writeFileSync(
      path.join(tmpDir, 'frontmcp.config.json'),
      JSON.stringify({ name: 'loaded-server', deployments: [{ target: 'node' }] }),
    );

    const config = await loadFrontMcpConfig(tmpDir);
    expect(config.name).toBe('loaded-server');
    expect(config.deployments[0].target).toBe('node');

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('should fall back to package.json when no config file', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-fallback-'));

    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: '@test/my-server', version: '3.0.0' }));

    const config = await loadFrontMcpConfig(tmpDir);
    expect(config.name).toBe('my-server'); // Strips scope
    expect(config.deployments[0].target).toBe('node'); // Default

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('should throw when no config file and no package.json', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-empty-'));

    await expect(loadFrontMcpConfig(tmpDir)).rejects.toThrow('No frontmcp.config found');

    fs.rmSync(tmpDir, { recursive: true });
  });
});
