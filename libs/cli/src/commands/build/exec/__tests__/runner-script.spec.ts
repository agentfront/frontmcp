import { generateRunnerScript } from '../runner-script';
import { type FrontmcpExecConfig } from '../config';

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

    it('should include --target cli in comment when cliMode is true', () => {
      const config: FrontmcpExecConfig = { name: 'my-app' };
      const script = generateRunnerScript(config, true);

      expect(script).toContain('CLI Executable');
      expect(script).toContain('--target cli');
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

    it('should include --target node in comment for SEA mode', () => {
      const config: FrontmcpExecConfig = { name: 'my-app' };
      const script = generateRunnerScript(config, false, true);

      expect(script).toContain('--target node');
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

  // #448 / #451 — the node-target runner now honors `--stdio`: it exports
  // FRONTMCP_STDIO=1 (so the @FrontMcp decorator serves over stdio instead of
  // binding a TCP port) and execs the bundle/binary. CLI-mode runners delegate
  // `--stdio` to the CLI bundle's own parser instead.
  describe('generateRunnerScript (--stdio)', () => {
    it('routes --stdio to FRONTMCP_STDIO=1 in the JS server runner', () => {
      const config: FrontmcpExecConfig = { name: 'demo', version: '0.1.0' };
      const script = generateRunnerScript(config, /* cliMode */ false, /* seaMode */ false);
      expect(script).toContain('--stdio)');
      expect(script).toContain('export FRONTMCP_STDIO=1');
    });

    it('routes --stdio to FRONTMCP_STDIO=1 in the SEA server runner', () => {
      const config: FrontmcpExecConfig = { name: 'demo', version: '0.1.0' };
      const script = generateRunnerScript(config, /* cliMode */ false, /* seaMode */ true);
      expect(script).toContain('--stdio)');
      expect(script).toContain('export FRONTMCP_STDIO=1');
    });

    it('documents --stdio in the server runner --help output', () => {
      const config: FrontmcpExecConfig = { name: 'demo', version: '0.1.0' };
      const script = generateRunnerScript(config, false, false);
      expect(script).toMatch(/--stdio.*stdin\/stdout JSON-RPC/i);
    });

    it('notes --stdio as an allowed exception in the rejection message', () => {
      const config: FrontmcpExecConfig = { name: 'demo' };
      const script = generateRunnerScript(config, false, false);
      expect(script).toContain('except --stdio');
    });

    it('does NOT add a --stdio interceptor in CLI mode (the CLI bundle parses it)', () => {
      const config: FrontmcpExecConfig = { name: 'demo' };
      const cliScript = generateRunnerScript(config, /* cliMode */ true, /* seaMode */ false);
      expect(cliScript).not.toContain('--stdio)');
      expect(cliScript).not.toContain('export FRONTMCP_STDIO=1');
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

    // #377 — node-target runner used to silently boot the HTTP server when
    // invoked with `--help`. Server runners now intercept --help/--version/
    // --print-manifest and reject other flags up front.
    describe('node-target --help interception', () => {
      it('intercepts --help in JS-mode server runner', () => {
        const config: FrontmcpExecConfig = { name: 'demo', version: '0.1.0' };
        const script = generateRunnerScript(config, /* cliMode */ false, /* seaMode */ false);
        expect(script).toContain('case "${1:-}"');
        expect(script).toContain('-h|--help)');
        expect(script).toContain('--version)');
        expect(script).toContain('--print-manifest)');
        expect(script).toContain('demo v0.1.0');
      });

      it('intercepts --help in SEA-mode server runner', () => {
        const config: FrontmcpExecConfig = { name: 'demo', version: '0.1.0' };
        const script = generateRunnerScript(config, /* cliMode */ false, /* seaMode */ true);
        expect(script).toContain('-h|--help)');
        expect(script).toContain('--print-manifest)');
      });

      it('rejects other --flags with a guiding error and exit 2', () => {
        const config: FrontmcpExecConfig = { name: 'demo' };
        const script = generateRunnerScript(config, /* cliMode */ false, /* seaMode */ false);
        expect(script).toContain('--*)');
        expect(script).toContain('exit 2');
        expect(script).toContain('build with --target cli');
      });

      it('does NOT intercept flags in CLI-mode runner (CLI bundle has its own parser)', () => {
        const config: FrontmcpExecConfig = { name: 'demo' };
        const cliScript = generateRunnerScript(config, /* cliMode */ true, /* seaMode */ false);
        expect(cliScript).not.toContain('-h|--help)');
      });
    });
  });
});
