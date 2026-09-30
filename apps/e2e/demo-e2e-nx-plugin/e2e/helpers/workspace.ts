import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

export const REPO_ROOT = resolve(__dirname, '../../../../..');
export const PLUGIN_DIST = join(REPO_ROOT, 'libs', 'nx-plugin', 'dist');
export const CLI_BIN = join(REPO_ROOT, 'libs', 'cli', 'dist', 'src', 'core', 'cli.js');
const TSC = join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

const RUNNER = join(__dirname, 'run-generator.cjs');

/** Load an executor's implementation from the built package's `executors.json`. */
export function loadExecutor<T>(name: string): T {
  const manifest = JSON.parse(readFileSync(join(PLUGIN_DIST, 'executors.json'), 'utf8')) as {
    executors: Record<string, { implementation: string }>;
  };
  const entry = manifest.executors[name];
  if (!entry) throw new Error(`Executor "${name}" is not registered in executors.json`);

  return require(join(PLUGIN_DIST, entry.implementation)).default as T;
}

/**
 * Run a generator from the built package against a real folder, in its own Node process
 * (the way the Nx CLI does), and write the result to disk.
 */
export async function generate(root: string, name: string, options: Record<string, unknown>): Promise<void> {
  try {
    execFileSync(
      process.execPath,
      [RUNNER, PLUGIN_DIST, root, name, JSON.stringify({ skipFormat: true, ...options })],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    throw new Error(`Generator "${name}" failed:\n${e.stdout ?? ''}${e.stderr ?? ''}`, { cause: err });
  }
}

export interface TempWorkspace {
  root: string;
  cleanup: () => void;
}

/**
 * A scratch folder outside the repo. Its `node_modules` is a symlink to the
 * repo's, so the workspace resolves the locally built `frontmcp`, SDK and testing packages.
 */
export function createScratchDir(): TempWorkspace {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'frontmcp-nx-e2e-')));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Scaffold a workspace with the `workspace` generator and link the repo's dependencies into it. */
export async function createWorkspace(options: { sampleApp?: boolean } = {}): Promise<TempWorkspace & { ws: string }> {
  const scratch = createScratchDir();
  await generate(scratch.root, 'workspace', {
    name: 'ws',
    skipInstall: true,
    skipGit: true,
    createSampleApp: options.sampleApp ?? true,
  });
  const ws = join(scratch.root, 'ws');
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(ws, 'node_modules'), 'dir');
  return { ...scratch, ws };
}

export function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

export interface TscResult {
  ok: boolean;
  output: string;
}

/**
 * `tsc --noEmit -p <project>` using the repo's compiler.
 * Declaration emit is off: the scratch workspace links the repo's `node_modules`, so TS cannot name
 * zod types through a portable path (TS2742), which a real install never hits.
 */
export function typecheck(cwd: string, project: string): TscResult {
  try {
    const output = execFileSync(process.execPath, [TSC, '--noEmit', '--declaration', 'false', '-p', project], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { ok: true, output };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** Nx hands executors a context; this is the part the FrontMCP executors read. */
export function executorContext(ws: string, projectName: string, projectRoot: string) {
  return {
    root: ws,
    cwd: ws,
    projectName,
    projectsConfigurations: { version: 2, projects: { [projectName]: { root: projectRoot } } },
    isVerbose: false,
    projectGraph: { nodes: {}, dependencies: {} },
    nxJsonConfiguration: {},
  };
}
