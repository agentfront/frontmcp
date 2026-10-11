/**
 * A `cli` deployment's `cli` block in the `deployments[]` config shape reaches the
 * generated CLI: `excludeTools` hides tools, `oauth` configures `login`, and
 * `authRequired` refuses server calls until the user has logged in.
 */
import { execFileSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';

import { ensureDir, mkdtemp, rm, writeFile } from '@frontmcp/utils';

import { runFrontmcpCli, type CliResult } from './helpers/exec-cli';

// The scratch project lives inside this app so `node_modules` resolves upward to the repo root.
const SCRATCH_ROOT = path.resolve(__dirname, '..');
const APP_NAME = 'cli-options-demo';

describe('build --target cli honors the deployment cli block', () => {
  let projectDir: string;
  let homeDir: string;

  function runBuiltCli(args: string[]): CliResult {
    try {
      const stdout = execFileSync(
        process.execPath,
        [path.join(projectDir, 'dist', 'cli', `${APP_NAME}-cli.bundle.js`), ...args],
        {
          cwd: projectDir,
          encoding: 'utf-8',
          timeout: 30000,
          env: { ...process.env, NODE_ENV: 'test', HOME: homeDir, FRONTMCP_HOME: path.join(homeDir, '.frontmcp') },
        },
      );
      return { stdout, stderr: '', exitCode: 0 };
    } catch (err: unknown) {
      const error = err as { stdout?: string; stderr?: string; status?: number };
      return { stdout: error.stdout ?? '', stderr: error.stderr ?? '', exitCode: error.status ?? 1 };
    }
  }

  beforeAll(async () => {
    projectDir = await mkdtemp(path.join(SCRATCH_ROOT, '.scratch-cli-options-'));
    homeDir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-cli-options-home-'));
    await ensureDir(path.join(projectDir, 'src'));
    await writeFile(
      path.join(projectDir, 'src', 'main.ts'),
      `import 'reflect-metadata';
import { App, FrontMcp, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';

@Tool({ name: 'visible-tool', description: 'Shown in the CLI', inputSchema: {} })
class VisibleTool extends ToolContext {
  async execute() {
    return 'visible';
  }
}

@Tool({ name: 'hidden-tool', description: 'Excluded from the CLI', inputSchema: {} })
class HiddenTool extends ToolContext {
  async execute() {
    return 'hidden';
  }
}

@App({ name: 'options', tools: [VisibleTool, HiddenTool] })
class OptionsApp {}

@FrontMcp({
  info: { name: 'CLI Options', version: '1.0.0' },
  apps: [OptionsApp],
  auth: { mode: 'public' },
  logging: { level: LogLevel.Warn, enableConsole: false },
})
export default class Server {}
`,
    );
    await writeFile(
      path.join(projectDir, 'frontmcp.config.js'),
      `module.exports = {
  name: '${APP_NAME}',
  version: '1.0.0',
  entry: './src/main.ts',
  deployments: [
    {
      target: 'cli',
      cli: {
        authRequired: true,
        excludeTools: ['hidden-tool'],
        oauth: { serverUrl: 'https://auth.example.com', clientId: '${APP_NAME}' },
      },
    },
  ],
};\n`,
    );
    const { exitCode, stderr } = runFrontmcpCli(['build', '--target', 'cli', '--js'], undefined, projectDir);
    expect({ exitCode, errors: stderr.split('\n').filter((line) => /error/i.test(line)) }).toEqual({
      exitCode: 0,
      errors: [],
    });
  }, 180_000);

  afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  });

  it('leaves cli.excludeTools out of the generated commands', () => {
    const { stdout, exitCode } = runBuiltCli(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('visible-tool');
    expect(stdout).not.toContain('hidden-tool');
  });

  it('uses cli.oauth as the login defaults', () => {
    const { stdout, exitCode } = runBuiltCli(['login', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('https://auth.example.com');
  });

  it('refuses a tool call until the user has logged in', () => {
    const { stderr, exitCode } = runBuiltCli(['visible-tool']);
    expect(exitCode).toBe(1);
    expect(stderr).toContain(`Not logged in. Run "${APP_NAME} login" or "${APP_NAME} connect --token <token>" first.`);
  });
});
