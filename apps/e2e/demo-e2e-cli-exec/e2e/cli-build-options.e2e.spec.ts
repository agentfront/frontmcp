/**
 * `build.esbuild` in the `deployments[]` config shape reaches the bundles of
 * `--target node` and `--target cli`: an `external` stays a runtime `require()`
 * and a `define` is substituted.
 */
import { execFileSync } from 'child_process';
import * as path from 'path';

import { ensureDir, mkdtemp, readFile, rm, writeFile } from '@frontmcp/utils';

import { runFrontmcpCli } from './helpers/exec-cli';

// The scratch project lives inside this app so `node_modules` resolves upward to the repo root.
const SCRATCH_ROOT = path.resolve(__dirname, '..');
const APP_NAME = 'build-options-demo';
const FLAVOR = 'configured-flavor';
// A line only semver's own source contains, so its presence means semver was inlined.
const SEMVER_SOURCE_MARKER = 'SEMVER_SPEC_VERSION';

describe('build.esbuild reaches --target node and --target cli bundles', () => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await mkdtemp(path.join(SCRATCH_ROOT, '.scratch-build-options-'));
    await ensureDir(path.join(projectDir, 'src'));
    await writeFile(
      path.join(projectDir, 'src', 'main.ts'),
      `import 'reflect-metadata';
import { App, FrontMcp, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';
import * as semver from 'semver';

@Tool({ name: 'flavor', description: 'Build flavor and a semver check', inputSchema: {} })
class FlavorTool extends ToolContext {
  async execute() {
    return \`\${process.env.BUILD_FLAVOR} \${semver.valid('1.2.3')}\`;
  }
}

@App({ name: 'flavor', tools: [FlavorTool] })
class FlavorApp {}

@FrontMcp({
  info: { name: 'Build Options', version: '1.0.0' },
  apps: [FlavorApp],
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
  build: {
    esbuild: { external: ['semver'], define: { 'process.env.BUILD_FLAVOR': '"${FLAVOR}"' } },
  },
  deployments: [{ target: 'node' }, { target: 'cli' }],
};\n`,
    );
  });

  afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  function expectConfiguredBundle(bundle: string): void {
    expect(bundle).toContain(FLAVOR);
    expect(bundle).toMatch(/require\("semver"\)/);
    expect(bundle).not.toContain(SEMVER_SOURCE_MARKER);
  }

  it('applies external and define to the --target node bundle', async () => {
    const { exitCode, stderr } = runFrontmcpCli(['build', '--target', 'node'], undefined, projectDir);
    expect({ exitCode, errors: stderr.split('\n').filter((line) => /error/i.test(line)) }).toEqual({
      exitCode: 0,
      errors: [],
    });
    expectConfiguredBundle(await readFile(path.join(projectDir, 'dist', 'node', `${APP_NAME}.bundle.js`)));
  }, 180_000);

  it('applies them to the --target cli bundles, and the CLI runs with semver loaded at runtime', async () => {
    const { exitCode, stderr } = runFrontmcpCli(['build', '--target', 'cli', '--js'], undefined, projectDir);
    expect({ exitCode, errors: stderr.split('\n').filter((line) => /error/i.test(line)) }).toEqual({
      exitCode: 0,
      errors: [],
    });
    expectConfiguredBundle(await readFile(path.join(projectDir, 'dist', 'cli', `${APP_NAME}.bundle.js`)));

    const output = execFileSync(
      process.execPath,
      [path.join(projectDir, 'dist', 'cli', `${APP_NAME}-cli.bundle.js`), 'flavor'],
      {
        cwd: projectDir,
        encoding: 'utf-8',
        timeout: 60_000,
        env: { ...process.env, NODE_ENV: 'test' },
      },
    );
    expect(output).toContain(`${FLAVOR} 1.2.3`);
  }, 180_000);
});
