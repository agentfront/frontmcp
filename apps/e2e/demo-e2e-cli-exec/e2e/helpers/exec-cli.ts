import { execFileSync, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const FIXTURE_DIR = path.resolve(__dirname, '../../fixture');
const DIST_DIR = path.join(FIXTURE_DIR, 'dist');
const CLI_BUNDLE = path.join(DIST_DIR, 'cli-exec-demo-cli.bundle.js');
const SERVER_BUNDLE = path.join(DIST_DIR, 'cli-exec-demo.bundle.js');
const MANIFEST = path.join(DIST_DIR, 'cli-exec-demo.manifest.json');

let buildDone = false;

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

  if (fs.existsSync(CLI_BUNDLE) && fs.existsSync(SERVER_BUNDLE) && fs.existsSync(MANIFEST)) {
    buildDone = true;
    return DIST_DIR;
  }

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

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}
