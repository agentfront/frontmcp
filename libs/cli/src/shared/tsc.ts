// file: libs/cli/src/shared/tsc.ts
// Spawn the TypeScript compiler without dropping the project's module resolver.

import { existsSync } from 'fs';
import * as path from 'path';

import { runCmd } from '@frontmcp/utils';

export type DetectedPackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

/** Lockfile → package manager, in detection order. First match wins. */
const LOCKFILE_TO_PACKAGE_MANAGER: ReadonlyArray<readonly [string, DetectedPackageManager]> = [
  ['bun.lockb', 'bun'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
];

/** Yarn Plug'n'Play ships its resolver as a committed `.pnp.cjs` at the project root. */
const PNP_RUNTIME_FILES = ['.pnp.cjs', '.pnp.js'];

/**
 * Detect the package manager a project uses from its lockfile, falling back
 * to npm when none is present.
 */
export function detectPackageManager(cwd: string): DetectedPackageManager {
  for (const [lockfile, manager] of LOCKFILE_TO_PACKAGE_MANAGER) {
    if (existsSync(path.join(cwd, lockfile))) return manager;
  }
  return 'npm';
}

/** Whether the project resolves modules through Yarn Plug'n'Play. */
export function isYarnPnpProject(cwd: string): boolean {
  return PNP_RUNTIME_FILES.some((file) => existsSync(path.join(cwd, file)));
}

/**
 * Locate the `tsc` entry script inside the project's own `typescript` install.
 *
 * Resolution goes through `typescript/package.json` rather than
 * `typescript/bin/tsc` because the latter is not listed in the package's
 * `exports` map, so resolving it directly fails with
 * `ERR_PACKAGE_PATH_NOT_EXPORTED` on modern Node.
 */
export function resolveProjectTsc(cwd: string): string | undefined {
  try {
    const manifest = require.resolve('typescript/package.json', { paths: [cwd] });
    const tscBin = path.join(path.dirname(manifest), 'bin', 'tsc');
    return existsSync(tscBin) ? tscBin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Command + args that invoke `tsc` through a package manager, so the child
 * process inherits whatever resolver that manager installs (Yarn PnP included).
 */
export function packageManagerTscCommand(
  manager: DetectedPackageManager,
  args: string[],
): { command: string; args: string[] } {
  switch (manager) {
    case 'yarn':
      return { command: 'yarn', args: ['tsc', ...args] };
    case 'pnpm':
      return { command: 'pnpm', args: ['exec', 'tsc', ...args] };
    case 'bun':
      return { command: 'bun', args: ['x', 'tsc', ...args] };
    default:
      return { command: 'npx', args: ['-y', 'tsc', ...args] };
  }
}

/**
 * Run the TypeScript compiler for a project.
 *
 * Issue #534: the build used to shell out to `npx tsc`. `npx` starts a fresh
 * Node process that never loads `.pnp.cjs`, so under Yarn Plug'n'Play — the
 * default for Yarn 4, and what `frontmcp create` scaffolds — nothing in
 * `compilerOptions.types` resolves and every build dies with a wall of TS2688
 * errors that point at `tsconfig.json` instead of at the spawn.
 *
 * Resolution order:
 *  1. The project's own `typescript`, run through `process.execPath`. The child
 *     inherits `NODE_OPTIONS` (which is where Yarn puts `--require .pnp.cjs`),
 *     so this is correct for npm, pnpm, Yarn node-modules and Yarn PnP alike.
 *  2. The detected package manager's own runner, which sets up the resolver
 *     itself when the CLI was invoked from outside it.
 */
export async function runTsc(args: string[], opts: { cwd?: string } = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();

  const projectTsc = resolveProjectTsc(cwd);
  if (projectTsc) {
    await runCmd(process.execPath, [projectTsc, ...args], { cwd });
    return;
  }

  const manager = detectPackageManager(cwd);
  const { command, args: commandArgs } = packageManagerTscCommand(manager, args);
  try {
    await runCmd(command, commandArgs, { cwd });
  } catch (err) {
    throw new Error(
      `Could not run the TypeScript compiler via \`${command}\`.\n` +
        `  ${(err as Error).message}\n` +
        `Hint: no local \`typescript\` was resolvable from ${cwd}. Add it to the project ` +
        `(\`${manager} add -D typescript\`) so the build can run it directly.`,
      { cause: err },
    );
  }
}
