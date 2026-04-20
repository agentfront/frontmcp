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
    expect(manifest.server.mcp_config.env).toEqual({
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
