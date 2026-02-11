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
});
