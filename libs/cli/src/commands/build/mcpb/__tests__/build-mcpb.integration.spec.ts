/**
 * Integration test for the buildMcpb() pipeline.
 *
 * Mocks the heavy stages (tsc, esbuild, schema extraction, SEA) and verifies
 * that the MCPB-specific stages (stage layout, manifest generation, zip, and
 * round-trip validation) produce a spec-compliant `.mcpb` archive.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('@frontmcp/utils', () => ({
  ...jest.requireActual('@frontmcp/utils'),
  ensureDir: jest.fn().mockResolvedValue(undefined),
  runCmd: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../../core/colors', () => ({
  c: (_color: string, text: string) => text,
}));

jest.mock('../../../../core/tsconfig', () => ({
  REQUIRED_DECORATOR_FIELDS: { target: 'ES2022' },
}));

jest.mock('../../../../shared/fs', () => ({
  resolveEntry: jest.fn().mockResolvedValue('/fake/src/main.ts'),
}));

jest.mock('../../exec/esbuild-bundler', () => ({
  bundleWithEsbuild: jest.fn(),
  formatSize: (n: number) => `${n} B`,
}));

jest.mock('../../exec/config', () => {
  const actual = jest.requireActual('../../exec/config');
  return {
    ...actual,
    loadExecConfig: jest.fn(),
  };
});

jest.mock('../../exec/cli-runtime/schema-extractor', () => ({
  extractSchemas: jest.fn(),
  SYSTEM_TOOL_NAMES: new Set<string>(),
}));

import { buildMcpb } from '../index';
import { validateMcpb } from '../validate';
import { loadExecConfig } from '../../exec/config';
import { bundleWithEsbuild } from '../../exec/esbuild-bundler';
import { extractSchemas } from '../../exec/cli-runtime/schema-extractor';

const mockLoadExecConfig = loadExecConfig as jest.Mock;
const mockBundleWithEsbuild = bundleWithEsbuild as jest.Mock;
const mockExtractSchemas = extractSchemas as jest.Mock;

describe('buildMcpb integration', () => {
  let tmp: string;
  let projectRoot: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpb-e2e-'));
    projectRoot = path.join(tmp, 'project');
    fs.mkdirSync(projectRoot, { recursive: true });

    fs.writeFileSync(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({
        name: 'demo-app',
        version: '1.2.3',
        description: 'Demo MCP server',
        author: 'Ada <ada@example.com>',
        license: 'MIT',
      }),
    );
    fs.writeFileSync(path.join(projectRoot, 'README.md'), '# Demo\n');
    fs.writeFileSync(path.join(projectRoot, 'icon.png'), 'fake-png');

    process.chdir(projectRoot);

    mockLoadExecConfig.mockResolvedValue({
      name: 'demo-app',
      version: '1.2.3',
      nodeVersion: '>=22.0.0',
      setup: {
        steps: [
          {
            id: 'api-token',
            prompt: 'API Token',
            description: 'Token for calling the API',
            jsonSchema: { type: 'string' },
            sensitive: true,
          },
          {
            id: 'max-items',
            prompt: 'Max items',
            jsonSchema: { type: 'number', minimum: 1, maximum: 100, default: 25 },
          },
        ],
      },
    });

    mockBundleWithEsbuild.mockImplementation(async (_entry: string, outDir: string) => {
      const bundlePath = path.join(outDir, 'demo-app.bundle.js');
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(bundlePath, 'module.exports = function () {};');
      return { bundlePath, bundleSize: 34 };
    });

    mockExtractSchemas.mockResolvedValue({
      tools: [
        { name: 'greet', description: 'Say hi', inputSchema: {} },
        { name: 'farewell', description: 'Say bye', inputSchema: {} },
      ],
      resources: [],
      resourceTemplates: [],
      prompts: [{ name: 'welcome', description: 'Welcome message' }],
      jobs: [],
      capabilities: { skills: false, jobs: false, workflows: false },
      skillAssets: [],
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it('produces a validatable .mcpb archive with manifest + tools + user_config', async () => {
    await buildMcpb({ _: [], outDir: 'dist/mcpb' });

    const archivePath = path.join(projectRoot, 'dist', 'mcpb', 'demo-app-1.2.3.mcpb');
    expect(fs.existsSync(archivePath)).toBe(true);

    const validation = await validateMcpb(archivePath);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);

    const manifest = validation.manifest!;
    expect(manifest.name).toBe('demo-app');
    expect(manifest.version).toBe('1.2.3');
    expect(manifest.author).toEqual({ name: 'Ada', email: 'ada@example.com' });
    expect(manifest.license).toBe('MIT');
    expect(manifest.tools?.map((t) => t.name).sort()).toEqual(['farewell', 'greet']);
    expect(manifest.prompts_generated).toBe(true);
    expect(manifest.server.type).toBe('node');
    expect(manifest.server.entry_point).toBe('server/index.js');
    expect(mockBundleWithEsbuild).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ selfContained: true, outputName: 'demo-app.server' }),
    );
    expect(manifest.server.mcp_config.env).toEqual({
      FRONTMCP_STDIO: '1',
      API_TOKEN: '${user_config.apiToken}',
      MAX_ITEMS: '${user_config.maxItems}',
    });
    expect(manifest.user_config?.apiToken.sensitive).toBe(true);
    expect(manifest.user_config?.maxItems.min).toBe(1);
    expect(manifest.user_config?.maxItems.max).toBe(100);

    // Archive contains expected entries
    expect(validation.entries).toContain('manifest.json');
    expect(validation.entries).toContain('server/index.js');
    expect(validation.entries).toContain('server/package.json');
    expect(validation.entries).toContain('icon.png');
    expect(validation.entries).toContain('README.md');

    // Stage dir cleaned up
    expect(fs.existsSync(path.join(projectRoot, 'dist', 'mcpb', '__stage'))).toBe(false);
  });

  it('leaves the stage directory intact when --stage-only is set', async () => {
    await buildMcpb({ _: [], outDir: 'dist/mcpb', stageOnly: true });

    const stageDir = path.join(projectRoot, 'dist', 'mcpb', '__stage');
    expect(fs.existsSync(stageDir)).toBe(true);
    expect(fs.existsSync(path.join(stageDir, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, 'server', 'index.js'))).toBe(true);
  });

  it('passes each deployment userConfig entry and the deployment env to the server', async () => {
    mockLoadExecConfig.mockResolvedValue({ name: 'demo-app', version: '1.2.3', nodeVersion: '>=22.0.0' });
    const configParsed = {
      name: 'demo-app',
      deployments: [
        {
          target: 'mcpb' as const,
          userConfig: {
            deskApiKey: { type: 'string' as const, title: 'Help desk API key', required: true, sensitive: true },
            exportFolder: { type: 'directory' as const, title: 'Export folder', default: '${HOME}/Documents' },
          },
          env: { DESK_REGION: 'eu' },
        },
      ],
    };

    await buildMcpb({ _: [], outDir: 'dist/mcpb' }, configParsed);

    const validation = await validateMcpb(path.join(projectRoot, 'dist', 'mcpb', 'demo-app-1.2.3.mcpb'));
    expect(validation.errors).toEqual([]);
    expect(Object.keys(validation.manifest?.user_config ?? {})).toEqual(['deskApiKey', 'exportFolder']);
    expect(validation.manifest?.server.mcp_config.env).toEqual({
      DESK_REGION: 'eu',
      DESK_API_KEY: '${user_config.deskApiKey}',
      EXPORT_FOLDER: '${user_config.exportFolder}',
      FRONTMCP_STDIO: '1',
    });
  });

  it('warns that includeNodeModules has no effect and ships no node_modules', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await buildMcpb(
        { _: [], outDir: 'dist/mcpb' },
        { name: 'demo-app', deployments: [{ target: 'mcpb', includeNodeModules: true }] },
      );
      const loggedLines = logSpy.mock.calls.map((call) => String(call[0]));
      expect(loggedLines).toContainEqual(expect.stringContaining('includeNodeModules is deprecated and has no effect'));
    } finally {
      logSpy.mockRestore();
    }
    const validation = await validateMcpb(path.join(projectRoot, 'dist', 'mcpb', 'demo-app-1.2.3.mcpb'));
    expect(validation.errors).toEqual([]);
    expect(validation.entries?.some((entry) => entry.includes('node_modules'))).toBe(false);
  });

  describe('native addons listed in build.dependencies.nativeAddons', () => {
    function writePackage(dir: string, manifest: Record<string, unknown>, files: Record<string, string> = {}): void {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
      for (const [rel, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), content);
      }
    }

    function nativeAddonConfig(nativeAddons: string[]) {
      return {
        name: 'demo-app',
        version: '1.2.3',
        nodeVersion: '>=22.0.0',
        deployments: [{ target: 'mcpb' as const }],
        build: { dependencies: { nativeAddons } },
      };
    }

    it('ships each addon with its .node binary and dependencies, built for this platform', async () => {
      writePackage(
        path.join(projectRoot, 'node_modules', 'fake-native-addon'),
        { name: 'fake-native-addon', version: '1.0.0', dependencies: { 'fake-bindings': '^1.0.0' } },
        { 'index.js': 'module.exports = require("fake-bindings")("addon");', 'build/Release/addon.node': 'binary' },
      );
      writePackage(path.join(projectRoot, 'node_modules', 'fake-bindings'), { name: 'fake-bindings', version: '1.0.0' }, { 'index.js': '' });
      const config = nativeAddonConfig(['fake-native-addon']);
      mockLoadExecConfig.mockResolvedValue(config);

      await buildMcpb({ _: [], outDir: 'dist/mcpb' }, config);

      const validation = await validateMcpb(path.join(projectRoot, 'dist', 'mcpb', 'demo-app-1.2.3.mcpb'));
      expect(validation.errors).toEqual([]);
      expect(validation.entries).toEqual(
        expect.arrayContaining([
          'server/node_modules/fake-native-addon/build/Release/addon.node',
          'server/node_modules/fake-native-addon/index.js',
          'server/node_modules/fake-bindings/package.json',
        ]),
      );
      expect(validation.manifest?.compatibility?.platforms).toEqual([process.platform]);
    });

    it('refuses native addons together with an SEA build, before building anything', async () => {
      const config = nativeAddonConfig(['fake-native-addon']);
      mockLoadExecConfig.mockResolvedValue(config);
      await expect(buildMcpb({ _: [], outDir: 'dist/mcpb', sea: true }, config)).rejects.toThrow(
        'An SEA binary can only load Node built-ins, so it cannot load the native addon(s) fake-native-addon (build.dependencies.nativeAddons). Build the mcpb without --sea, sea.enabled and sea.mergeFrom.',
      );
      expect(mockBundleWithEsbuild).not.toHaveBeenCalled();
    });

    it('keeps platforms the deployment declares, warns about other OSes, and names the build platform and arch', async () => {
      writePackage(path.join(projectRoot, 'node_modules', 'fake-native-addon'), { name: 'fake-native-addon' }, { 'addon.node': 'binary' });
      const otherOs = process.platform === 'linux' ? 'win32' : 'linux';
      const config = {
        ...nativeAddonConfig(['fake-native-addon']),
        deployments: [{ target: 'mcpb' as const, compatibility: { platforms: [otherOs] as Array<'darwin' | 'linux' | 'win32'> } }],
      };
      mockLoadExecConfig.mockResolvedValue(config);
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        await buildMcpb({ _: [], outDir: 'dist/mcpb' }, config);
        const loggedLines = logSpy.mock.calls.map((call) => String(call[0]));
        const builtFor = `${process.platform}-${process.arch}`;
        expect(loggedLines).toContainEqual(expect.stringContaining(`this archive runs only on ${builtFor}`));
        expect(loggedLines).toContainEqual(
          expect.stringContaining(`compatibility.platforms lists ${otherOs}, but the native addon binaries only load on ${builtFor}`),
        );
      } finally {
        logSpy.mockRestore();
      }
      const validation = await validateMcpb(path.join(projectRoot, 'dist', 'mcpb', 'demo-app-1.2.3.mcpb'));
      expect(validation.manifest?.compatibility?.platforms).toEqual([otherOs]);
    });

    it('fails the build, naming the addon, when it is not installed', async () => {
      const config = nativeAddonConfig(['not-installed-addon']);
      mockLoadExecConfig.mockResolvedValue(config);
      await expect(buildMcpb({ _: [], outDir: 'dist/mcpb' }, config)).rejects.toThrow(/not-installed-addon/);
    });
  });

  it('produces deterministic archives across back-to-back builds', async () => {
    await buildMcpb({ _: [], outDir: 'dist/mcpb' });
    const archivePath = path.join(projectRoot, 'dist', 'mcpb', 'demo-app-1.2.3.mcpb');
    const hashA = fs.readFileSync(archivePath);

    // Second build (fresh bundle stubbed identically)
    await buildMcpb({ _: [], outDir: 'dist/mcpb' });
    const hashB = fs.readFileSync(archivePath);

    expect(hashA.equals(hashB)).toBe(true);
  });
});
