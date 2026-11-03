/**
 * E2E: the generated CLI of a server given as a config object validates its options as the server does. An invalid
 * `transport.persistence` stops it at startup, where it opened the CLI's session store with it; a `redis` with neither
 * host nor url says so; a Vercel KV `jobs.store.redis` is refused, where it connected to localhost. A build whose
 * config the schema refuses names each invalid field in its manifest warning, where it printed the error as JSON.
 */
import * as path from 'path';

import { ensureDir, fileExists, mkdtemp, rm, writeFile } from '@frontmcp/utils';

import { runCliBundle, runFrontmcpCli } from './helpers/exec-cli';

// The scratch project lives inside this app so `node_modules` resolves upward to the repo root.
const SCRATCH_ROOT = path.resolve(__dirname, '..');
const APP_NAME = 'config-validation-demo';
const BUILD_TIMEOUT_MS = 150_000;

describe('the generated CLI of a config object validates its options as the server does', () => {
  let projectDir: string;
  let cliBundle: string;

  beforeAll(async () => {
    projectDir = await mkdtemp(path.join(SCRATCH_ROOT, '.scratch-config-validation-'));
    await ensureDir(path.join(projectDir, 'src'));
    await writeFile(
      path.join(projectDir, 'src', 'main.ts'),
      `import 'reflect-metadata';
import { App, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({ name: 'greet', description: 'Greet someone', inputSchema: { name: z.string() } })
class GreetTool extends ToolContext {
  async execute(input: { name: string }) {
    return \`Hello, \${input.name}\`;
  }
}

@App({ name: 'config-validation', tools: [GreetTool] })
class ConfigValidationApp {}

export default {
  info: { name: 'Config Validation Demo', version: '1.0.0' },
  apps: [ConfigValidationApp],
  auth: { mode: 'public' as const },
  logging: { level: LogLevel.Warn, enableConsole: false },
  ...JSON.parse(process.env['CONFIG_OVERRIDES'] ?? '{}'),
};
`,
    );
    await writeFile(
      path.join(projectDir, 'frontmcp.config.js'),
      `module.exports = {
  name: '${APP_NAME}',
  version: '1.0.0',
  entry: './src/main.ts',
  build: { esbuild: { external: ['zod'] } },
  deployments: [{ target: 'cli' }],
};\n`,
    );
    const build = runFrontmcpCli(['build', '--target', 'cli', '--js'], undefined, projectDir, BUILD_TIMEOUT_MS);
    expect({ exitCode: build.exitCode, stderr: build.exitCode === 0 ? '' : build.stderr }).toEqual({
      exitCode: 0,
      stderr: '',
    });
    cliBundle = path.join(projectDir, 'dist', 'cli', `${APP_NAME}-cli.bundle.js`);
  }, BUILD_TIMEOUT_MS + 30_000);

  afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  const greet = (overrides: Record<string, unknown>) =>
    runCliBundle(cliBundle, ['greet', '--name', 'Ada'], { CONFIG_OVERRIDES: JSON.stringify(overrides) });

  it('fails at startup on an invalid transport.persistence, with the message of the server, and opens no store', async () => {
    const sessions = path.join(projectDir, 'invalid-sessions.sqlite');

    const { exitCode, stderr } = greet({ transport: { persistence: { sqlite: { path: sessions, encryption: {} } } } });

    expect(exitCode).toBe(1);
    expect(stderr.replace(/\s/g, '')).toContain('"path":["transport","persistence"]');
    expect(await fileExists(sessions)).toBe(false);
  });

  it('runs with a valid transport.persistence', () => {
    const sessions = path.join(projectDir, 'sessions.sqlite');

    expect(greet({ transport: { persistence: { sqlite: { path: sessions } } } })).toEqual(
      expect.objectContaining({ exitCode: 0, stdout: expect.stringContaining('Hello, Ada') }),
    );
  });

  it('says what a redis with neither host nor url is missing', () => {
    const { exitCode, stderr } = greet({ redis: { port: 6380 } });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('redis needs host or url');
  });

  it('refuses a Vercel KV jobs.store.redis instead of connecting to localhost', () => {
    const { exitCode, stderr } = greet({ jobs: { enabled: true, store: { redis: { provider: 'vercel-kv' } } } });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Vercel KV is not supported for job stores');
  });

  it(
    'names each invalid field in the build warning when the schema refuses the config',
    () => {
      const build = runFrontmcpCli(
        ['build', '--target', 'node'],
        { CONFIG_OVERRIDES: JSON.stringify({ info: { name: 5, version: '1.0.0' } }) },
        projectDir,
        BUILD_TIMEOUT_MS,
      );

      expect(build.exitCode).toBe(0);
      expect(build.stdout).toContain(
        'frontmcp.manifest.json not written: info.name: Invalid input: expected string, received number',
      );
      expect(build.stdout).not.toContain('"code"');
    },
    BUILD_TIMEOUT_MS,
  );
});
