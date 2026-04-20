import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const APP_NAME = 'mcpb-demo';
const APP_VERSION = '1.2.3';

const FIXTURE_DIR = path.resolve(__dirname, '../../fixture');
const ROOT_DIR = path.resolve(FIXTURE_DIR, '../../../..');
const FRONTMCP_BIN = path.join(ROOT_DIR, 'libs', 'cli', 'dist', 'src', 'core', 'cli.js');
const DIST_DIR = path.join(FIXTURE_DIR, 'dist');
const MCPB_DIR = path.join(DIST_DIR, 'mcpb');
const ARCHIVE_PATH = path.join(MCPB_DIR, `${APP_NAME}-${APP_VERSION}.mcpb`);

let buildDone = false;

export function getAppName(): string {
  return APP_NAME;
}

export function getAppVersion(): string {
  return APP_VERSION;
}

export function getFixtureDir(): string {
  return FIXTURE_DIR;
}

export function getDistDir(): string {
  return DIST_DIR;
}

export function getMcpbDir(): string {
  return MCPB_DIR;
}

export function getArchivePath(): string {
  return ARCHIVE_PATH;
}

export function getFrontmcpBin(): string {
  return FRONTMCP_BIN;
}

/**
 * Run `frontmcp build --target mcpb` inside the fixture directory. Idempotent
 * across tests in the same Jest worker — subsequent calls return immediately.
 */
export async function ensureBuild(extraArgs: string[] = []): Promise<string> {
  if (buildDone && extraArgs.length === 0) return ARCHIVE_PATH;

  // Clear any prior artifacts to guarantee a fresh build.
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }

  console.log('[e2e:mcpb] Building MCPB archive...');
  execFileSync('node', [FRONTMCP_BIN, 'build', '--target', 'mcpb', ...extraArgs], {
    cwd: FIXTURE_DIR,
    stdio: 'pipe',
    timeout: 150000,
    env: { ...process.env, NODE_ENV: 'production' },
  });
  console.log('[e2e:mcpb] Build complete.');

  buildDone = extraArgs.length === 0;
  return ARCHIVE_PATH;
}

/** Force the next ensureBuild() call to rebuild even if a prior build ran. */
export function resetBuildCache(): void {
  buildDone = false;
}

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Run the workspace `frontmcp` CLI from an arbitrary cwd, collecting output. */
export function runFrontmcp(args: string[], cwd: string = FIXTURE_DIR): CliResult {
  try {
    const stdout = execFileSync('node', [FRONTMCP_BIN, ...args], {
      cwd,
      timeout: 60000,
      encoding: 'utf-8',
      env: { ...process.env, NODE_ENV: 'test' },
    });
    return { stdout: stdout.toString(), stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const error = err as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      status?: number;
    };
    return {
      stdout: (error.stdout || '').toString(),
      stderr: (error.stderr || '').toString(),
      exitCode: error.status ?? 1,
    };
  }
}
