import { execFileSync, spawn, type ChildProcess } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { isAbsolute, join, resolve } from 'path';

import type { ExecutorContext } from './executor-context.js';

export interface FrontmcpInvocation {
  command: string;
  args: string[];
  /** The project's own folder: the CLI reads `tsconfig.json`, `jest.config.*` and `frontmcp.config.*` from here. */
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/** Absolute path of the project's folder; the workspace root when the project is unknown. */
export function getProjectRoot(context: ExecutorContext): string {
  const projectRoot = context.projectName
    ? context.projectsConfigurations?.projects?.[context.projectName]?.root
    : undefined;
  return projectRoot ? resolve(context.root, projectRoot) : context.root;
}

/** Nx hands options over relative to the workspace root, while the CLI resolves them from the project folder. */
export function toAbsolute(context: ExecutorContext, path: string): string {
  return isAbsolute(path) ? path : resolve(context.root, path);
}

/**
 * Find the `frontmcp` CLI the workspace has installed. Running it through `npx`
 * would download whatever is newest on the registry whenever it is missing,
 * so the executors refuse to fall back to that.
 */
export function resolveFrontmcpBin(workspaceRoot: string): string {
  const manifestPath = join(workspaceRoot, 'node_modules', 'frontmcp', 'package.json');
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { bin?: string | Record<string, string> };
      const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.['frontmcp'];
      if (bin) {
        const binPath = join(workspaceRoot, 'node_modules', 'frontmcp', bin);
        if (existsSync(binPath)) return binPath;
      }
    } catch {
      // fall through to the "not installed" error below
    }
  }
  throw new Error(
    `The "frontmcp" CLI is not installed in ${workspaceRoot}. Add it to the workspace ` +
      `(\`npm install --save-dev frontmcp\`) so the executors run the version you pinned.`,
  );
}

export function buildFrontmcpInvocation(
  context: ExecutorContext,
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {},
): FrontmcpInvocation {
  return {
    command: process.execPath,
    args: [resolveFrontmcpBin(context.root), ...args],
    cwd: getProjectRoot(context),
    env: { ...process.env, FORCE_COLOR: '1', ...extraEnv },
  };
}

export function describeInvocation(invocation: FrontmcpInvocation): string {
  return `frontmcp ${invocation.args.slice(1).join(' ')} (in ${invocation.cwd})`;
}

/** Run the CLI to completion in the project folder. Never throws: the executor result carries the outcome. */
export function runFrontmcp(
  context: ExecutorContext,
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {},
): { success: boolean } {
  try {
    const invocation = buildFrontmcpInvocation(context, args, extraEnv);
    console.log(`Running: ${describeInvocation(invocation)}`);
    execFileSync(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      stdio: 'inherit',
      env: invocation.env,
    });
    return { success: true };
  } catch (err) {
    // A failing CLI already printed its own output; only report problems that happened before it ran.
    if (err instanceof Error && !('status' in err)) console.error(err.message);
    return { success: false };
  }
}

/** Start the CLI as a long-running child in the project folder. */
export function spawnFrontmcp(
  context: ExecutorContext,
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {},
): ChildProcess | undefined {
  try {
    const invocation = buildFrontmcpInvocation(context, args, extraEnv);
    console.log(`Running: ${describeInvocation(invocation)}`);
    return spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      stdio: 'inherit',
      env: invocation.env,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return undefined;
  }
}

/** Resolve with the child's exit code; kill the child if the executor is stopped early. */
export async function waitForExit(child: ChildProcess): Promise<number> {
  try {
    return await new Promise<number>((resolvePromise) => {
      child.on('error', () => resolvePromise(1));
      child.on('close', (code) => resolvePromise(code ?? 1));
    });
  } finally {
    if (!child.killed) child.kill();
  }
}
