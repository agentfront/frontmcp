import { readNxJson, type Tree } from '@nx/devkit';

export type WorkspacePackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

export interface PackageManagerCommands {
  /** Installs the workspace dependencies. */
  install: string;
  /** Runs a locally installed bin, e.g. `npx nx`. */
  exec: string;
}

const COMMANDS: Record<WorkspacePackageManager, PackageManagerCommands> = {
  npm: { install: 'npm install', exec: 'npx' },
  yarn: { install: 'yarn install', exec: 'yarn' },
  pnpm: { install: 'pnpm install', exec: 'pnpm exec' },
  bun: { install: 'bun install', exec: 'bunx' },
};

const LOCKFILES: ReadonlyArray<readonly [string, WorkspacePackageManager]> = [
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
];

function isPackageManager(value: unknown): value is WorkspacePackageManager {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(COMMANDS, value);
}

/** The package manager the workspace uses: `nx.json` `cli.packageManager`, else its lockfile, else npm. */
export function detectWorkspacePackageManager(tree: Tree): WorkspacePackageManager {
  const configured = readNxJson(tree)?.cli?.packageManager;
  if (isPackageManager(configured)) return configured;
  const match = LOCKFILES.find(([lockfile]) => tree.exists(lockfile));
  return match ? match[1] : 'npm';
}

export function getPackageManagerCommands(tree: Tree): PackageManagerCommands {
  return COMMANDS[detectWorkspacePackageManager(tree)];
}
