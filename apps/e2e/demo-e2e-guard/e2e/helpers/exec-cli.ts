import { execFileSync } from 'child_process';
import * as path from 'path';

const FIXTURE_DIR = path.resolve(__dirname, '../../fixture');
const DIST_DIR = path.join(FIXTURE_DIR, 'dist', 'cli');
const CLI_BUNDLE = path.join(DIST_DIR, 'guard-cli-demo-cli.bundle.js');

let buildDone = false;

export function getDistDir(): string {
  return DIST_DIR;
}

export function getCliBundlePath(): string {
  return CLI_BUNDLE;
}

export async function ensureBuild(): Promise<string> {
  if (buildDone) return DIST_DIR;

  const rootDir = path.resolve(FIXTURE_DIR, '../../../..');
  const frontmcpBin = path.join(rootDir, 'libs', 'cli', 'dist', 'src', 'core', 'cli.js');

  console.log('[e2e] Building Guard CLI exec bundle...');
  execFileSync('node', [frontmcpBin, 'build', '--target', 'cli', '--js'], {
    cwd: FIXTURE_DIR,
    stdio: 'pipe',
    timeout: 90000,
    env: { ...process.env, NODE_ENV: 'production' },
  });
  console.log('[e2e] Build complete.');

  buildDone = true;
  return DIST_DIR;
}

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function runCli(args: string[], extraEnv?: Record<string, string>): CliResult {
  try {
    const stdout = execFileSync('node', [CLI_BUNDLE, ...args], {
      cwd: DIST_DIR,
      timeout: 30000,
      encoding: 'utf-8',
      env: { ...process.env, NODE_ENV: 'test', ...extraEnv },
    });
    return { stdout: stdout.toString(), stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const error = err as { stdout?: string | Buffer; stderr?: string | Buffer; status?: number };
    return {
      stdout: (error.stdout || '').toString(),
      stderr: (error.stderr || '').toString(),
      exitCode: error.status ?? 1,
    };
  }
}
