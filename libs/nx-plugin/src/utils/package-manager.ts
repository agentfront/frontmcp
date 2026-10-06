import { logger, readJson, readNxJson, updateJson, type Tree } from '@nx/devkit';

export type WorkspacePackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

/** Commands a generated Dockerfile runs, from the workspace root. */
export interface DockerPackageManagerCommands {
  /** Makes the package manager available on the `node` image, when npm isn't it. */
  setup?: string;
  /** `NAME=value` the builder stage sets before installing, so the install lays out `node_modules`. */
  env?: string;
  /** Installs exactly what the lockfile records, without lifecycle scripts. */
  installFrozen: string;
  /** Removes dev dependencies from the installed `node_modules`. */
  pruneProduction: string;
}

export interface PackageManagerCommands {
  /** Installs the workspace dependencies. */
  install: string;
  /** Runs a locally installed bin, e.g. `npx nx`. */
  exec: string;
  docker: DockerPackageManagerCommands;
}

const COMMANDS: Record<WorkspacePackageManager, PackageManagerCommands> = {
  npm: {
    install: 'npm install',
    exec: 'npx',
    docker: { installFrozen: 'npm ci --ignore-scripts', pruneProduction: 'npm prune --omit=dev' },
  },
  yarn: {
    install: 'yarn install',
    exec: 'yarn',
    docker: {
      setup: 'corepack enable',
      env: 'YARN_NODE_LINKER=node-modules',
      installFrozen: 'yarn install --immutable --mode=skip-build',
      pruneProduction: 'yarn workspaces focus --all --production',
    },
  },
  pnpm: {
    install: 'pnpm install',
    exec: 'pnpm exec',
    docker: {
      setup: 'corepack enable',
      installFrozen: 'pnpm install --frozen-lockfile --ignore-scripts',
      pruneProduction: 'pnpm prune --prod --ignore-scripts',
    },
  },
  bun: {
    install: 'bun install',
    exec: 'bunx',
    docker: {
      setup: 'npm install -g bun',
      installFrozen: 'bun install --frozen-lockfile --ignore-scripts',
      pruneProduction: 'bun install --frozen-lockfile --production --ignore-scripts',
    },
  },
};

/** Yarn 1 has no `.yarnrc.yml`, `--immutable` or `workspaces focus`. */
const YARN_CLASSIC_DOCKER: DockerPackageManagerCommands = {
  setup: 'corepack enable',
  installFrozen: 'yarn install --frozen-lockfile --ignore-scripts',
  pruneProduction: 'yarn install --frozen-lockfile --production --ignore-scripts',
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

function rootPackageManagerField(tree: Tree): string | undefined {
  if (!tree.exists('package.json')) return undefined;
  const packageManager: unknown = readJson(tree, 'package.json').packageManager;
  return typeof packageManager === 'string' ? packageManager : undefined;
}

/** Yarn 2+ writes `.yarnrc.yml`, a `__metadata` lockfile header, or a `yarn@2+` packageManager. */
function isYarnBerry(tree: Tree): boolean {
  if (tree.exists('.yarnrc.yml')) return true;
  if (/^yarn@(?!1\.)/.test(rootPackageManagerField(tree) ?? '')) return true;
  return tree.read('yarn.lock', 'utf-8')?.includes('__metadata:') ?? false;
}

function pinsYarnVersion(tree: Tree): boolean {
  if (rootPackageManagerField(tree)?.startsWith('yarn@')) return true;
  return /^yarnPath:/m.test(tree.read('.yarnrc.yml', 'utf-8') ?? '');
}

/**
 * The image runs `corepack enable`, and corepack falls back to Yarn 1 unless the workspace pins a version, so a Yarn
 * Berry workspace without a pin gets the Yarn version the generator runs under as its `packageManager`.
 */
export function ensureYarnBerryPinned(tree: Tree, userAgent = process.env['npm_config_user_agent']): void {
  if (detectWorkspacePackageManager(tree) !== 'yarn' || !isYarnBerry(tree) || pinsYarnVersion(tree)) return;
  const runningYarnVersion = /\byarn\/(\d+\.\d+\.\d+)/.exec(userAgent ?? '')?.[1];
  if (runningYarnVersion && !runningYarnVersion.startsWith('1.') && tree.exists('package.json')) {
    updateJson(tree, 'package.json', (json) => ({ ...json, packageManager: `yarn@${runningYarnVersion}` }));
    return;
  }
  logger.warn(
    'The workspace uses Yarn Berry but pins no Yarn version, so the Docker image would install with Yarn 1. ' +
      'Run `yarn set version <version>` to add a packageManager field before building the image.',
  );
}

export function getPackageManagerCommands(tree: Tree): PackageManagerCommands {
  const packageManager = detectWorkspacePackageManager(tree);
  if (packageManager === 'yarn' && !isYarnBerry(tree)) {
    return { ...COMMANDS.yarn, docker: YARN_CLASSIC_DOCKER };
  }
  return COMMANDS[packageManager];
}
