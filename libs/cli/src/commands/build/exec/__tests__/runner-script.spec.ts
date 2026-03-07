import { generateRunnerScript } from '../runner-script';
import { FrontmcpExecConfig } from '../config';

describe('runner-script', () => {
  describe('generateRunnerScript', () => {
    it('should generate a valid bash script', () => {
      const config: FrontmcpExecConfig = {
        name: 'test-app',
        version: '1.0.0',
      };

      const script = generateRunnerScript(config);

      expect(script).toContain('#!/usr/bin/env bash');
      expect(script).toContain('set -euo pipefail');
      expect(script).toContain('test-app');
      expect(script).toContain('test-app.bundle.js');
    });

    it('should check for Node.js', () => {
      const config: FrontmcpExecConfig = {
        name: 'my-server',
        nodeVersion: '>=22.0.0',
      };

      const script = generateRunnerScript(config);
      expect(script).toContain('command -v node');
      expect(script).toContain('22');
    });

    it('should load .env if present', () => {
      const config: FrontmcpExecConfig = { name: 'app' };
      const script = generateRunnerScript(config);
      expect(script).toContain('.env');
      expect(script).toContain('source');
    });

    it('should execute the bundle with node', () => {
      const config: FrontmcpExecConfig = { name: 'app' };
      const script = generateRunnerScript(config);
      expect(script).toContain('exec node');
      expect(script).toContain('app.bundle.js');
    });
  });

  describe('generateRunnerScript (CLI mode)', () => {
    it('should dispatch to CLI bundle when cliMode is true', () => {
      const config: FrontmcpExecConfig = { name: 'my-app' };
      const script = generateRunnerScript(config, true);

      expect(script).toContain('my-app-cli.bundle.js');
      expect(script).not.toContain('BUNDLE="${SCRIPT_DIR}/my-app.bundle.js"');
    });

    it('should include --cli in comment when cliMode is true', () => {
      const config: FrontmcpExecConfig = { name: 'my-app' };
      const script = generateRunnerScript(config, true);

      expect(script).toContain('CLI Executable');
      expect(script).toContain('--cli');
    });

    it('should use server bundle when cliMode is false', () => {
      const config: FrontmcpExecConfig = { name: 'my-app' };
      const script = generateRunnerScript(config, false);

      expect(script).toContain('my-app.bundle.js');
      expect(script).not.toContain('my-app-cli.bundle.js');
    });
  });

  describe('generateRunnerScript (SEA mode)', () => {
    it('should reference binary name in SEA server mode', () => {
      const config: FrontmcpExecConfig = { name: 'my-app' };
      const script = generateRunnerScript(config, false, true);

      expect(script).toContain('my-app-bin');
      expect(script).not.toContain('command -v node');
    });

    it('should reference cli binary in SEA CLI mode', () => {
      const config: FrontmcpExecConfig = { name: 'my-app' };
      const script = generateRunnerScript(config, true, true);

      expect(script).toContain('my-app-cli-bin');
    });

    it('should include --sea in comment', () => {
      const config: FrontmcpExecConfig = { name: 'my-app' };
      const script = generateRunnerScript(config, false, true);

      expect(script).toContain('--sea');
      expect(script).toContain('single executable');
    });

    it('should load .env in SEA mode', () => {
      const config: FrontmcpExecConfig = { name: 'my-app' };
      const script = generateRunnerScript(config, false, true);

      expect(script).toContain('.env');
      expect(script).toContain('source');
    });

    it('should check binary exists in SEA mode', () => {
      const config: FrontmcpExecConfig = { name: 'my-app' };
      const script = generateRunnerScript(config, false, true);

      expect(script).toContain('Binary not found');
    });

    it('should not check for Node.js in SEA mode', () => {
      const config: FrontmcpExecConfig = { name: 'my-app' };
      const script = generateRunnerScript(config, false, true);

      expect(script).not.toContain('command -v node');
      expect(script).not.toContain('NODE_MAJOR');
    });

    it('should exec binary directly in SEA mode', () => {
      const config: FrontmcpExecConfig = { name: 'my-app' };
      const script = generateRunnerScript(config, false, true);

      expect(script).toContain('exec "${BINARY}"');
      expect(script).not.toContain('exec node');
    });
  });

  describe('extractMinMajor fallback', () => {
    it('should default min Node major to 22 when version has no digits', () => {
      const config: FrontmcpExecConfig = { name: 'app', nodeVersion: 'latest' };
      const script = generateRunnerScript(config);
      expect(script).toContain('-lt "22"');
    });

    it('should extract min major from nodeVersion string', () => {
      const config: FrontmcpExecConfig = { name: 'app', nodeVersion: '>=20.0.0' };
      const script = generateRunnerScript(config);
      expect(script).toContain('-lt "20"');
    });
  });
});
