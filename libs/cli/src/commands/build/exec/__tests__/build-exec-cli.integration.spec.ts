/**
 * Integration test for the buildExec() pipeline.
 * Tests both server-only and CLI modes using real file I/O in a temp directory,
 * with mocked compilation and bundling steps.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ---- Mocks (jest.mock is hoisted, so factories must not reference module-level const) ----

jest.mock('@frontmcp/utils', () => ({
  ensureDir: jest.fn().mockResolvedValue(undefined),
  fileExists: jest.fn().mockResolvedValue(false),
  runCmd: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../../core/colors', () => ({
  c: (_color: string, text: string) => text,
}));

jest.mock('../../../../core/tsconfig', () => ({
  REQUIRED_DECORATOR_FIELDS: { target: 'ES2022' },
}));

jest.mock('../esbuild-bundler', () => ({
  bundleWithEsbuild: jest.fn(),
  formatSize: (bytes: number) => `${bytes} B`,
}));

jest.mock('../config', () => {
  const actual = jest.requireActual('../config');
  return {
    ...actual,
    loadExecConfig: jest.fn(),
  };
});

jest.mock('../../../../shared/fs', () => ({
  resolveEntry: jest.fn().mockResolvedValue('/fake/src/main.ts'),
}));

jest.mock('../setup', () => {
  const actual = jest.requireActual('../setup');
  return {
    ...actual,
    validateStepGraph: jest.fn().mockReturnValue([]),
  };
});

// CLI runtime mocks — mock actual modules (dynamic import('./x.js') resolves to ./x.ts in jest)
jest.mock('../cli-runtime/schema-extractor', () => ({
  extractSchemas: jest.fn(),
  SYSTEM_TOOL_NAMES: new Set([
    'searchSkills', 'loadSkills',
    'list-jobs', 'execute-job', 'get-job-status', 'register-job', 'remove-job',
    'list-workflows', 'execute-workflow', 'get-workflow-status', 'register-workflow', 'remove-workflow',
  ]),
}));

jest.mock('../cli-runtime/generate-cli-entry', () => ({
  generateCliEntry: jest.fn(),
  resolveToolCommandName: jest.fn().mockImplementation((name: string) => {
    const cmdName = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])([A-Z][a-z])/g, '$1-$2').toLowerCase().replace(/_/g, '-');
    return { cmdName, wasRenamed: false };
  }),
}));

jest.mock('../cli-runtime/output-formatter', () => ({
  generateOutputFormatterSource: jest.fn(),
}));

jest.mock('../cli-runtime/session-manager', () => ({
  generateSessionManagerSource: jest.fn(),
}));

jest.mock('../cli-runtime/credential-store', () => ({
  generateCredentialStoreSource: jest.fn(),
}));

jest.mock('../cli-runtime/oauth-helper', () => ({
  generateOAuthHelperSource: jest.fn(),
}));

jest.mock('../cli-runtime/cli-bundler', () => ({
  bundleCliWithEsbuild: jest.fn(),
}));

jest.mock('../cli-runtime/daemon-client', () => ({
  generateDaemonClientSource: jest.fn().mockReturnValue('// daemon client\nmodule.exports = {};'),
}));

jest.mock('../sea-builder', () => ({
  buildSea: jest.fn(),
}));

// ---- Imports (after mocks are set up) ----

import { buildExec } from '../index';
import { loadExecConfig } from '../config';
import { bundleWithEsbuild } from '../esbuild-bundler';
import { runCmd, fileExists } from '@frontmcp/utils';
import { validateStepGraph } from '../setup';

// Get typed mock references
const mockLoadExecConfig = loadExecConfig as jest.MockedFunction<typeof loadExecConfig>;
const mockBundleWithEsbuild = bundleWithEsbuild as jest.MockedFunction<typeof bundleWithEsbuild>;
const mockRunCmd = runCmd as jest.MockedFunction<typeof runCmd>;
const mockFileExists = fileExists as jest.MockedFunction<typeof fileExists>;
const mockValidateStepGraph = validateStepGraph as jest.MockedFunction<typeof validateStepGraph>;

// CLI runtime mock references
function getCliMocks() {
  const schemaExtractor = require('../cli-runtime/schema-extractor');
  const cliEntry = require('../cli-runtime/generate-cli-entry');
  const outputFormatter = require('../cli-runtime/output-formatter');
  const sessionManager = require('../cli-runtime/session-manager');
  const credentialStore = require('../cli-runtime/credential-store');
  const oauthHelper = require('../cli-runtime/oauth-helper');
  const cliBundler = require('../cli-runtime/cli-bundler');

  return {
    extractSchemas: schemaExtractor.extractSchemas as jest.Mock,
    generateCliEntry: cliEntry.generateCliEntry as jest.Mock,
    resolveToolCommandName: cliEntry.resolveToolCommandName as jest.Mock,
    generateOutputFormatterSource: outputFormatter.generateOutputFormatterSource as jest.Mock,
    generateSessionManagerSource: sessionManager.generateSessionManagerSource as jest.Mock,
    generateCredentialStoreSource: credentialStore.generateCredentialStoreSource as jest.Mock,
    generateOAuthHelperSource: oauthHelper.generateOAuthHelperSource as jest.Mock,
    bundleCliWithEsbuild: cliBundler.bundleCliWithEsbuild as jest.Mock,
  };
}

let tmpDir: string;
let outDir: string;

beforeEach(() => {
  jest.clearAllMocks();

  // Create real temp directory
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buildexec-test-'));
  outDir = path.join(tmpDir, 'dist');
  fs.mkdirSync(outDir, { recursive: true });

  // Default config
  mockLoadExecConfig.mockResolvedValue({
    name: 'test-app',
    version: '2.0.0',
    nodeVersion: '>=22.0.0',
  });

  mockFileExists.mockResolvedValue(false);
  mockRunCmd.mockResolvedValue(undefined);

  // Mock esbuild bundler: write a fake bundle file
  mockBundleWithEsbuild.mockImplementation(async (_entry: string, outDirPath: string, config: { name: string }, options?: { outputName?: string }) => {
    const name = options?.outputName || config.name;
    const bundlePath = path.join(outDirPath, `${name}.bundle.js`);
    fs.writeFileSync(bundlePath, '// fake server bundle\nmodule.exports = {};');
    return { bundlePath, bundleSize: 1024 };
  });

  // Setup SEA builder mock
  const seaBuilder = require('../sea-builder');
  (seaBuilder.buildSea as jest.Mock).mockImplementation(async (_bundlePath: string, seaOutDir: string, appName: string) => {
    const executablePath = path.join(seaOutDir, `${appName}-bin`);
    fs.writeFileSync(executablePath, '// fake SEA binary');
    return { executablePath, executableSize: 50000 };
  });

  // Setup CLI runtime module mocks
  const cli = getCliMocks();

  cli.extractSchemas.mockResolvedValue({
    tools: [
      {
        name: 'search_users',
        description: 'Search for users',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
      {
        name: 'add_numbers',
        description: 'Add two numbers',
        inputSchema: {
          type: 'object',
          properties: { a: { type: 'number' }, b: { type: 'number' } },
        },
      },
    ],
    resources: [
      { uri: 'file://config.json', name: 'Config', description: 'App config' },
    ],
    resourceTemplates: [],
    prompts: [
      {
        name: 'code_review',
        description: 'Review code',
        arguments: [{ name: 'code', required: true }],
      },
    ],
    capabilities: { skills: false, jobs: false, workflows: false },
  });

  cli.generateCliEntry.mockReturnValue('// generated CLI entry\nvar { Command } = require("commander");');
  cli.generateOutputFormatterSource.mockReturnValue('// output formatter\nmodule.exports = {};');
  cli.generateSessionManagerSource.mockReturnValue('// session manager\nmodule.exports = {};');
  cli.generateCredentialStoreSource.mockReturnValue('// credential store\nmodule.exports = {};');
  cli.generateOAuthHelperSource.mockReturnValue('// oauth helper\nmodule.exports = {};');

  cli.bundleCliWithEsbuild.mockImplementation(async (_entry: string, outDirPath: string, config: { name: string }) => {
    const bundlePath = path.join(outDirPath, `${config.name}-cli.bundle.js`);
    fs.writeFileSync(bundlePath, '#!/usr/bin/env node\n// fake CLI bundle');
    return { bundlePath, bundleSize: 2048 };
  });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('buildExec() integration', () => {
  describe('server-only mode (cli = false)', () => {
    it('should produce server bundle, manifest, runner, and installer', async () => {
      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await buildExec({ outDir, cli: false } as any);

        expect(fs.existsSync(path.join(outDir, 'test-app.bundle.js'))).toBe(true);

        const manifestPath = path.join(outDir, 'test-app.manifest.json');
        expect(fs.existsSync(manifestPath)).toBe(true);
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        expect(manifest.name).toBe('test-app');
        expect(manifest.version).toBe('2.0.0');
        expect(manifest.bundle).toBe('test-app.bundle.js');

        const runnerPath = path.join(outDir, 'test-app');
        expect(fs.existsSync(runnerPath)).toBe(true);
        expect(fs.readFileSync(runnerPath, 'utf-8')).toContain('#!/usr/bin/env bash');

        const installerPath = path.join(outDir, 'install-test-app.sh');
        expect(fs.existsSync(installerPath)).toBe(true);
        expect(fs.readFileSync(installerPath, 'utf-8')).toContain('#!/usr/bin/env bash');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should NOT include cli in manifest in server-only mode', async () => {
      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await buildExec({ outDir, cli: false } as any);

        const manifest = JSON.parse(
          fs.readFileSync(path.join(outDir, 'test-app.manifest.json'), 'utf-8'),
        );
        expect(manifest.cli).toBeUndefined();
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should use server bundle in runner script when CLI disabled', async () => {
      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await buildExec({ outDir, cli: false } as any);

        const runnerContent = fs.readFileSync(path.join(outDir, 'test-app'), 'utf-8');
        expect(runnerContent).toContain('test-app.bundle.js');
        expect(runnerContent).not.toContain('test-app-cli.bundle.js');
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('CLI mode (cli = true)', () => {
    it('should produce all server artifacts plus CLI bundle', async () => {
      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await buildExec({ outDir, cli: true } as any);

        expect(fs.existsSync(path.join(outDir, 'test-app.bundle.js'))).toBe(true);
        expect(fs.existsSync(path.join(outDir, 'test-app.manifest.json'))).toBe(true);
        expect(fs.existsSync(path.join(outDir, 'test-app'))).toBe(true);
        expect(fs.existsSync(path.join(outDir, 'install-test-app.sh'))).toBe(true);
        expect(fs.existsSync(path.join(outDir, 'test-app-cli.bundle.js'))).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should include CLI metadata in manifest', async () => {
      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await buildExec({ outDir, cli: true } as any);

        const manifest = JSON.parse(
          fs.readFileSync(path.join(outDir, 'test-app.manifest.json'), 'utf-8'),
        );
        expect(manifest.cli).toBeDefined();
        expect(manifest.cli.enabled).toBe(true);
        expect(manifest.cli.cliBundle).toBe('test-app-cli.bundle.js');
        expect(manifest.cli.toolCount).toBe(2);
        expect(manifest.cli.resourceCount).toBe(1);
        expect(manifest.cli.templateCount).toBe(0);
        expect(manifest.cli.promptCount).toBe(1);
        expect(manifest.cli.oauthEnabled).toBe(false);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should dispatch runner to CLI bundle in CLI mode', async () => {
      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await buildExec({ outDir, cli: true } as any);

        const runnerContent = fs.readFileSync(path.join(outDir, 'test-app'), 'utf-8');
        expect(runnerContent).toContain('test-app-cli.bundle.js');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should clean up __cli_temp directory', async () => {
      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await buildExec({ outDir, cli: true } as any);

        expect(fs.existsSync(path.join(outDir, '__cli_temp'))).toBe(false);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should extract schemas from server bundle', async () => {
      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await buildExec({ outDir, cli: true } as any);

        const cli = getCliMocks();
        expect(cli.extractSchemas).toHaveBeenCalledTimes(1);
        expect(cli.extractSchemas.mock.calls[0][0]).toContain('test-app.bundle.js');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should pass correct options to generateCliEntry', async () => {
      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await buildExec({ outDir, cli: true } as any);

        const cli = getCliMocks();
        expect(cli.generateCliEntry).toHaveBeenCalledTimes(1);
        const entryOpts = cli.generateCliEntry.mock.calls[0][0];
        expect(entryOpts.appName).toBe('test-app');
        expect(entryOpts.appVersion).toBe('2.0.0');
        expect(entryOpts.serverBundleFilename).toBe('test-app.bundle.js');
        expect(entryOpts.schema.tools).toHaveLength(2);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('config flag vs opts flag', () => {
    it('should enable CLI mode from config.cli.enabled', async () => {
      mockLoadExecConfig.mockResolvedValue({
        name: 'test-app',
        version: '2.0.0',
        cli: { enabled: true },
      });

      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await buildExec({ outDir } as any);

        const cli = getCliMocks();
        expect(cli.extractSchemas).toHaveBeenCalledTimes(1);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should enable CLI mode from opts.cli flag', async () => {
      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await buildExec({ outDir, cli: true } as any);

        const cli = getCliMocks();
        expect(cli.extractSchemas).toHaveBeenCalledTimes(1);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('manifest structure', () => {
    it('should include correct base manifest fields', async () => {
      mockLoadExecConfig.mockResolvedValue({
        name: 'test-app',
        version: '2.0.0',
        nodeVersion: '>=22.0.0',
        storage: { type: 'sqlite', required: true },
        network: { defaultPort: 8080, supportsSocket: false },
      });

      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await buildExec({ outDir, cli: false } as any);

        const manifest = JSON.parse(
          fs.readFileSync(path.join(outDir, 'test-app.manifest.json'), 'utf-8'),
        );
        expect(manifest.nodeVersion).toBe('>=22.0.0');
        expect(manifest.storage).toEqual({ type: 'sqlite', required: true });
        expect(manifest.network).toEqual({ defaultPort: 8080, supportsSocket: false });
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('compilation step', () => {
    it('should call runCmd for TypeScript compilation', async () => {
      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await buildExec({ outDir, cli: false } as any);

        expect(mockRunCmd).toHaveBeenCalledTimes(1);
        expect(mockRunCmd.mock.calls[0][0]).toBe('npx');
        const args = mockRunCmd.mock.calls[0][1];
        expect(args).toContain('tsc');
        expect(args).toContain('--module');
        expect(args).toContain('commonjs');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should use --project flag when tsconfig.json exists', async () => {
      mockFileExists.mockResolvedValue(true);
      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await buildExec({ outDir, cli: false } as any);

        const args = mockRunCmd.mock.calls[0][1];
        expect(args).toContain('--project');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should use entry from opts and pass to resolveEntry', async () => {
      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await buildExec({ outDir, cli: false, entry: 'src/custom.ts' } as any);

        const { resolveEntry } = require('../../../../shared/fs');
        expect(resolveEntry).toHaveBeenCalledWith(expect.any(String), 'src/custom.ts');
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('setup validation', () => {
    it('should log warnings but continue when validateStepGraph returns warnings', async () => {
      mockValidateStepGraph.mockReturnValue(['Warning: step "b" may be unreachable']);
      mockLoadExecConfig.mockResolvedValue({
        name: 'test-app',
        version: '2.0.0',
        setup: { steps: [{ id: 'a', prompt: 'A' }] },
      });

      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        // Should not throw
        await buildExec({ outDir, cli: false } as any);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should throw on real validation errors from validateStepGraph', async () => {
      mockValidateStepGraph.mockReturnValue(['Step "a": next target "b" does not exist']);
      mockLoadExecConfig.mockResolvedValue({
        name: 'test-app',
        version: '2.0.0',
        setup: { steps: [{ id: 'a', prompt: 'A' }] },
      });

      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await expect(buildExec({ outDir, cli: false } as any))
          .rejects.toThrow('Setup questionnaire has validation errors');
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('SEA mode', () => {
    it('should call buildSea for server bundle in SEA mode', async () => {
      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await buildExec({ outDir, cli: false, sea: true } as any);

        const seaBuilder = require('../sea-builder');
        expect(seaBuilder.buildSea).toHaveBeenCalledTimes(1);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should rebuild selfContained bundle before SEA', async () => {
      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await buildExec({ outDir, cli: false, sea: true } as any);

        // First call: non-self-contained, second: self-contained for SEA
        expect(mockBundleWithEsbuild).toHaveBeenCalledTimes(2);
        const secondCall = mockBundleWithEsbuild.mock.calls[1];
        expect(secondCall[3]).toEqual(expect.objectContaining({ selfContained: true }));
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should call buildSea for CLI bundle when both sea and cli enabled', async () => {
      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await buildExec({ outDir, cli: true, sea: true } as any);

        const seaBuilder = require('../sea-builder');
        // Once for server, once for CLI
        expect(seaBuilder.buildSea).toHaveBeenCalledTimes(2);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should generate SEA runner script', async () => {
      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await buildExec({ outDir, cli: false, sea: true } as any);

        const runnerContent = fs.readFileSync(path.join(outDir, 'test-app'), 'utf-8');
        expect(runnerContent).toContain('single executable');
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('installer script', () => {
    it('should generate installer script', async () => {
      const originalCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        await buildExec({ outDir, cli: false } as any);

        const installerPath = path.join(outDir, 'install-test-app.sh');
        expect(fs.existsSync(installerPath)).toBe(true);
        const content = fs.readFileSync(installerPath, 'utf-8');
        expect(content).toContain('#!/usr/bin/env bash');
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});
