import { execFileSync, spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { StdioOptions } from 'node:child_process';

const APP_NAME = 'cli-exec-demo';
const FIXTURE_DIR = path.resolve(__dirname, '../../fixture');
const DIST_DIR = path.join(FIXTURE_DIR, 'dist');
const CLI_BUNDLE = path.join(DIST_DIR, 'cli-exec-demo-cli.bundle.js');
const SERVER_BUNDLE = path.join(DIST_DIR, 'cli-exec-demo.bundle.js');
const MANIFEST = path.join(DIST_DIR, 'cli-exec-demo.manifest.json');

// SEA build support — separate output dir to avoid interfering with regular builds
const SEA_DIST_DIR = path.join(FIXTURE_DIR, 'dist-sea');
const SEA_CLI_BINARY = path.join(SEA_DIST_DIR, `${APP_NAME}-cli-bin`);

let buildDone = false;
let seaBuildDone = false;
let seaBuildAvailable = false;

export function getDistDir(): string {
  return DIST_DIR;
}

export function getCliBundlePath(): string {
  return CLI_BUNDLE;
}

export function getServerBundlePath(): string {
  return SERVER_BUNDLE;
}

export function getManifestPath(): string {
  return MANIFEST;
}

export async function ensureBuild(): Promise<string> {
  if (buildDone) return DIST_DIR;

  const rootDir = path.resolve(FIXTURE_DIR, '../../../..');
  const frontmcpBin = path.join(rootDir, 'libs', 'cli', 'dist', 'src', 'core', 'cli.js');

  console.log('[e2e] Building CLI exec bundle...');
  execFileSync('node', [frontmcpBin, 'build', '--exec', '--cli'], {
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

/**
 * Spawn a long-running server process (CLI serve or server bundle).
 * Returns the ChildProcess for manual lifecycle management.
 */
export function spawnServer(
  command: string[],
  extraEnv?: Record<string, string>,
  stdio: StdioOptions = 'inherit',
): ChildProcess {
  const [bin, ...args] = command;
  return spawn(bin, args, {
    cwd: DIST_DIR,
    env: { ...process.env, NODE_ENV: 'test', ...extraEnv },
    stdio,
  });
}

export function spawnCli(args: string[], timeoutMs = 3000, extraEnv?: Record<string, string>): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn('node', [CLI_BUNDLE, ...args], {
      cwd: DIST_DIR,
      env: { ...process.env, NODE_ENV: 'test', ...extraEnv },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGINT');
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + err.message, exitCode: 1 });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}

// ─── SEA Build Helpers ──────────────────────────────────────────────────────

export function getSeaDistDir(): string {
  return SEA_DIST_DIR;
}

export function getSeaCliBinaryPath(): string {
  return SEA_CLI_BINARY;
}

export function isSeaBuildAvailable(): boolean {
  return seaBuildAvailable;
}

/**
 * Build the fixture with SEA enabled into a separate dist-sea/ directory.
 * Returns true if the SEA CLI binary was produced, false if SEA packaging
 * failed (e.g., missing postject or codesign).
 */
export async function ensureSeaBuild(): Promise<boolean> {
  if (seaBuildDone) return seaBuildAvailable;

  const rootDir = path.resolve(FIXTURE_DIR, '../../../..');
  const frontmcpBin = path.join(rootDir, 'libs', 'cli', 'dist', 'src', 'core', 'cli.js');

  console.log('[e2e:sea] Building CLI exec bundle with SEA...');
  try {
    execFileSync('node', [frontmcpBin, 'build', '--exec', '--cli', '--sea', '--out-dir', 'dist-sea'], {
      cwd: FIXTURE_DIR,
      stdio: 'pipe',
      timeout: 180000,
      env: { ...process.env, NODE_ENV: 'production' },
    });
    console.log('[e2e:sea] SEA build complete.');
  } catch (err: unknown) {
    const error = err as { stderr?: string | Buffer };
    console.warn(
      '[e2e:sea] SEA build failed (CLI bundle may still be available):',
      (error.stderr || '').toString().slice(0, 300),
    );
  }

  seaBuildAvailable = fs.existsSync(SEA_CLI_BINARY);
  seaBuildDone = true;

  if (seaBuildAvailable) {
    console.log(`[e2e:sea] SEA CLI binary available: ${SEA_CLI_BINARY}`);
  } else {
    console.warn('[e2e:sea] SEA CLI binary not available — SEA daemon tests will be skipped.');
  }

  return seaBuildAvailable;
}

/**
 * Run the SEA CLI binary directly (not via node).
 */
export function runSeaCli(args: string[], extraEnv?: Record<string, string>): CliResult {
  try {
    const stdout = execFileSync(SEA_CLI_BINARY, args, {
      cwd: SEA_DIST_DIR,
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
