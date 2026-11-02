/**
 * `frontmcp build` writes `frontmcp.manifest.json` next to each target's output: every tool, resource, resource
 * template, prompt and skill of the server with its schemas and app, and lints it against `instructionsBudget`.
 */
import { spawn } from 'child_process';
import * as net from 'node:net';
import * as path from 'path';

import { ensureDir, mkdtemp, readFile, rm, writeFile } from '@frontmcp/utils';

import { ensureBuild, getDistDir, runFrontmcpCli } from './helpers/exec-cli';

interface Manifest {
  manifestVersion: number;
  server: { name: string; version: string; instructions?: string };
  budget?: { instructions: number; toolDescription: number };
  apps: Array<{ id: string; name: string }>;
  tools: Array<{ name: string; app?: string; description?: string; inputSchema: Record<string, unknown> }>;
  resources: Array<{ uri: string; app?: string }>;
  resourceTemplates: Array<{ uriTemplate: string; app?: string }>;
  prompts: Array<{ name: string; app?: string }>;
  skills: Array<{ name: string; path: string; app?: string; hash?: string; tools: Array<{ name: string }> }>;
}

const SCRATCH_ROOT = path.resolve(__dirname, '..');
const BUILD_TIMEOUT_MS = 150_000;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        address && typeof address === 'object' ? resolve(address.port) : reject(new Error('no port')),
      );
    });
  });
}

describe('frontmcp build writes frontmcp.manifest.json', () => {
  beforeAll(async () => {
    await ensureBuild();
  });

  it('lists the entries of the fixture server with their schemas and owning app', async () => {
    const manifest = JSON.parse(await readFile(path.join(getDistDir(), 'frontmcp.manifest.json'))) as Manifest;
    const app = manifest.apps.find((candidate) => candidate.name === 'CliExec');

    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.server).toEqual(expect.objectContaining({ name: 'CLI Exec E2E Demo', version: '1.0.0' }));
    expect(manifest.budget).toEqual({ instructions: 1024, toolDescription: 1024 });
    expect(app).toBeDefined();
    expect(manifest.tools.find((tool) => tool.name === 'add')).toEqual(
      expect.objectContaining({
        app: app?.id,
        description: 'Add two numbers together',
        inputSchema: expect.objectContaining({
          properties: {
            a: expect.objectContaining({ type: 'number', description: 'First number' }),
            b: expect.objectContaining({ type: 'number', description: 'Second number' }),
          },
        }),
      }),
    );
    expect(manifest.resources).toEqual(
      expect.arrayContaining([expect.objectContaining({ uri: 'app://info', app: app?.id })]),
    );
    expect(manifest.resourceTemplates).toEqual(
      expect.arrayContaining([expect.objectContaining({ uriTemplate: 'items://item/{itemId}', app: app?.id })]),
    );
    expect(manifest.prompts.map((prompt) => prompt.name)).toEqual(expect.arrayContaining(['code-review']));
    expect(manifest.skills.find((skill) => skill.name === 'math-helper')).toEqual(
      expect.objectContaining({
        path: 'demo/math-helper',
        app: app?.id,
        tools: [expect.objectContaining({ name: 'add' })],
      }),
    );
    expect(manifest.skills.find((skill) => skill.name === 'greeting-helper')?.hash).toMatch(/^[0-9a-f]{64}$/);
    const names = manifest.tools.map((tool) => tool.name);
    expect(names).toEqual([...names].sort());
  });

  describe('the instructionsBudget lint', () => {
    let projectDir: string;
    let port: number;

    beforeAll(async () => {
      port = await freePort();
      projectDir = await mkdtemp(path.join(SCRATCH_ROOT, '.scratch-build-manifest-'));
      await ensureDir(path.join(projectDir, 'src'));
      await writeFile(
        path.join(projectDir, 'src', 'main.ts'),
        `import 'reflect-metadata';
import { App, FrontMcp, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';

@Tool({ name: 'wordy', description: '${'w'.repeat(120)}', inputSchema: {} })
class WordyTool extends ToolContext {
  async execute() {
    return 'ok';
  }
}

@Tool({ name: 'terse', inputSchema: {} })
class TerseTool extends ToolContext {
  async execute() {
    return 'ok';
  }
}

@App({ name: 'budget', tools: [WordyTool, TerseTool] })
class BudgetApp {}

@FrontMcp({
  info: { name: 'Budget Demo', version: '1.0.0' },
  apps: [BudgetApp],
  instructions: '${'i'.repeat(90)}',
  instructionsBudget: { instructions: 80, toolDescription: 100 },
  http: { port: ${port} },
  auth: { mode: 'public' },
  logging: { level: LogLevel.Warn },
})
export default class Server {}
`,
      );
      await writeFile(
        path.join(projectDir, 'frontmcp.config.js'),
        `module.exports = { name: 'budget-demo', version: '1.0.0', entry: './src/main.ts', deployments: [{ target: 'node' }] };\n`,
      );
    });

    afterAll(async () => {
      await rm(projectDir, { recursive: true, force: true });
    });

    it('warns about the budget and missing descriptions, and fails the build with --strict-lint', async () => {
      const lenient = runFrontmcpCli(['build', '--target', 'node'], undefined, projectDir, BUILD_TIMEOUT_MS);
      expect(lenient.exitCode).toBe(0);
      expect(lenient.stdout).toContain(
        'manifest lint (instructions-over-budget): The initialize instructions are 90 characters, over the instructionsBudget of 80.',
      );
      expect(lenient.stdout).toContain(
        'manifest lint (description-over-budget): Tool "wordy" has a 120-character description, over the instructionsBudget.toolDescription of 100.',
      );
      expect(lenient.stdout).toContain('manifest lint (missing-description): Tool "terse" has no description.');
      const manifest = JSON.parse(
        await readFile(path.join(projectDir, 'dist', 'node', 'frontmcp.manifest.json')),
      ) as Manifest;
      expect(manifest.budget).toEqual({ instructions: 80, toolDescription: 100 });

      const strict = runFrontmcpCli(
        ['build', '--target', 'node', '--strict-lint'],
        undefined,
        projectDir,
        BUILD_TIMEOUT_MS,
      );
      expect(strict.exitCode).toBe(1);
      expect(strict.stdout).toContain('3 manifest lint finding(s); --strict-lint fails the build.');
    }, 320_000);

    it('warns at startup when the built server is over its budget', async () => {
      const bundle = path.join(projectDir, 'dist', 'node', 'budget-demo.bundle.js');
      const child = spawn(process.execPath, [bundle], {
        cwd: projectDir,
        env: { ...process.env, NODE_ENV: 'production' },
      });
      let output = '';
      const warned = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 60_000);
        const onData = (chunk: Buffer) => {
          output += chunk.toString();
          if (output.includes('Tool "wordy" has a 120-character description')) {
            clearTimeout(timer);
            resolve(true);
          }
        };
        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve(output.includes('Tool "wordy" has a 120-character description'));
        });
      });
      child.kill('SIGTERM');

      expect({ warned, output: warned ? '' : output }).toEqual({ warned: true, output: '' });
      expect(output).toContain('The initialize instructions are 90 characters, over the instructionsBudget of 80');
    }, 90_000);
  });
});
