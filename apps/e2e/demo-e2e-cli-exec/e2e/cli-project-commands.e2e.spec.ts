/**
 * E2E for issue #409 — project-defined CLI commands.
 * Drives the compiled `frontmcp` bin with a temp project that has a
 * `frontmcp.config.json` defining `cli.commands`, and verifies:
 *  - `frontmcp --list-commands` enumerates [project] + [built-in] verbs
 *  - The project command dispatches to the runner with positionals + flags
 *  - A non-zero runner exit propagates to the parent without re-printing
 */

import { execFileSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';

import { mkdir, mkdtemp, readFile, rm, writeFile } from '@frontmcp/utils';

import { ensureBuild } from './helpers/exec-cli';

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..', '..');
const FRONTMCP_BIN = path.join(ROOT_DIR, 'libs', 'cli', 'dist', 'src', 'core', 'cli.js');

function runFrontmcpIn(
  cwd: string,
  args: string[],
  extraEnv?: Record<string, string>,
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [FRONTMCP_BIN, ...args], {
      cwd,
      timeout: 30000,
      encoding: 'utf-8',
      env: { ...process.env, NODE_ENV: 'test', ...extraEnv },
    });
    return { stdout: stdout.toString(), stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string | Buffer; stderr?: string | Buffer; status?: number };
    return {
      stdout: (e.stdout || '').toString(),
      stderr: (e.stderr || '').toString(),
      exitCode: e.status ?? 1,
    };
  }
}

describe('frontmcp project commands (issue #409)', () => {
  let tmp: string;

  beforeAll(async () => {
    await ensureBuild();
  });

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'fmcp-e2e-409-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('--list-commands enumerates built-in and project commands with tags', async () => {
    await mkdir(path.join(tmp, 'scripts'), { recursive: true });
    await writeFile(path.join(tmp, 'scripts', 'deploy.js'), 'process.exit(0);\n');
    await writeFile(
      path.join(tmp, 'frontmcp.config.json'),
      JSON.stringify({
        name: 'demo',
        deployments: [{ target: 'node' }],
        cli: {
          commands: {
            'project:deploy': {
              entry: './scripts/deploy.js',
              description: 'Project deploy',
            },
          },
        },
      }),
    );

    const { stdout, exitCode } = runFrontmcpIn(tmp, ['--list-commands']);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/dev\t\[built-in\]/);
    expect(stdout).toMatch(/build\t\[built-in\]/);
    expect(stdout).toMatch(/project:deploy\t\[project\]/);
  });

  it('dispatches a project command and forwards positionals + flags to the runner', async () => {
    await mkdir(path.join(tmp, 'scripts'), { recursive: true });
    const outFile = path.join(tmp, 'out.json');
    await writeFile(
      path.join(tmp, 'scripts', 'echo.js'),
      `const fs = require('fs');\n` +
        `fs.writeFileSync(${JSON.stringify(outFile)}, JSON.stringify({ argv: process.argv.slice(2), payload: JSON.parse(process.env.FRONTMCP_PROJECT_COMMAND) }));\n`,
    );
    await writeFile(
      path.join(tmp, 'frontmcp.config.json'),
      JSON.stringify({
        name: 'demo',
        deployments: [{ target: 'node' }],
        cli: {
          commands: {
            'project:echo': {
              entry: './scripts/echo.js',
              arguments: [{ name: 'env', required: true }],
              options: [{ flags: '--dry-run' }, { flags: '--count <num>' }],
            },
          },
        },
      }),
    );

    const { exitCode } = runFrontmcpIn(tmp, ['project:echo', 'prod', '--dry-run', '--count', '3']);
    expect(exitCode).toBe(0);

    const captured = JSON.parse(await readFile(outFile)) as {
      argv: string[];
      payload: { verb: string; positionals: unknown[]; options: Record<string, unknown> };
    };
    expect(captured.argv).toEqual(['prod', '--dry-run', '--count', '3']);
    expect(captured.payload.verb).toBe('project:echo');
    expect(captured.payload.positionals).toEqual(['prod']);
    expect(captured.payload.options.dryRun).toBe(true);
    expect(captured.payload.options.count).toBe('3');
  });

  it('propagates a non-zero exit from the runner without re-printing the error stack', async () => {
    await mkdir(path.join(tmp, 'scripts'), { recursive: true });
    await writeFile(path.join(tmp, 'scripts', 'fail.js'), `process.exit(7);\n`);
    await writeFile(
      path.join(tmp, 'frontmcp.config.json'),
      JSON.stringify({
        name: 'demo',
        deployments: [{ target: 'node' }],
        cli: { commands: { 'project:fail': { entry: './scripts/fail.js' } } },
      }),
    );

    const { exitCode, stderr } = runFrontmcpIn(tmp, ['project:fail']);
    expect(exitCode).toBe(7);
    expect(stderr).not.toMatch(/ProjectCommandFailedError/);
    expect(stderr).not.toMatch(/Project command "project:fail" exited with code/);
  });

  it('--list-commands appearing after a verb does NOT bypass the verb', async () => {
    await mkdir(path.join(tmp, 'scripts'), { recursive: true });
    const marker = path.join(tmp, 'ran.txt');
    await writeFile(
      path.join(tmp, 'scripts', 'mark.js'),
      `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`,
    );
    await writeFile(
      path.join(tmp, 'frontmcp.config.json'),
      JSON.stringify({
        name: 'demo',
        deployments: [{ target: 'node' }],
        cli: { commands: { mark: { entry: './scripts/mark.js' } } },
      }),
    );

    // `mark --list-commands` should run `mark` (and treat --list-commands as an unknown flag).
    runFrontmcpIn(tmp, ['mark', '--list-commands']);
    // The runner created the marker file → the verb ran, not the list flag.
    const exists = await readFile(marker)
      .then((s) => s === 'ran')
      .catch(() => false);
    expect(exists).toBe(true);
  });
});
