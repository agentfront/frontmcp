import { generateInstallerScript } from '../installer-script';
import { FrontmcpExecConfig } from '../config';

describe('installer-script', () => {
  describe('generateInstallerScript', () => {
    it('should generate a valid bash script', () => {
      const config: FrontmcpExecConfig = {
        name: 'test-app',
        version: '1.0.0',
      };

      const script = generateInstallerScript(config);

      expect(script).toContain('#!/usr/bin/env bash');
      expect(script).toContain('set -euo pipefail');
      expect(script).toContain('test-app');
    });

    it('should support --yes flag', () => {
      const config: FrontmcpExecConfig = { name: 'app' };
      const script = generateInstallerScript(config);
      expect(script).toContain('--yes');
      expect(script).toContain('SILENT');
    });

    it('should include native addon install when present', () => {
      const config: FrontmcpExecConfig = {
        name: 'app',
        dependencies: { nativeAddons: ['better-sqlite3'] },
      };
      const script = generateInstallerScript(config);
      expect(script).toContain('better-sqlite3');
      expect(script).toContain('npm install');
    });

    it('should skip native addon install when none', () => {
      const config: FrontmcpExecConfig = {
        name: 'app',
        dependencies: { nativeAddons: [] },
      };
      const script = generateInstallerScript(config);
      expect(script).toContain('No native addons required');
    });

    it('should set up SQLite data dir when storage is sqlite', () => {
      const config: FrontmcpExecConfig = {
        name: 'app',
        storage: { type: 'sqlite' },
      };
      const script = generateInstallerScript(config);
      expect(script).toContain('FRONTMCP_SQLITE_PATH');
      expect(script).toContain('data/app');
    });

    it('should install to ~/.frontmcp/apps/', () => {
      const config: FrontmcpExecConfig = { name: 'my-mcp' };
      const script = generateInstallerScript(config);
      expect(script).toContain('.frontmcp/apps');
    });
  });
});
