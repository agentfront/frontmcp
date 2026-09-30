/**
 * `vercel.json` contents for a FrontMCP project.
 *
 * Shared by the vercel build adapter and `frontmcp create --target vercel`, so a
 * scaffolded project and a built one run the same commands on Vercel. Kept free
 * of Node-only imports so the scaffold can load it cheaply.
 */

export type VercelPackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

interface PackageManagerConfig {
  install: string;
  /** How the package manager runs a locally installed bin. */
  exec: string;
}

// Vercel runs `buildCommand` itself, so it must build the vercel target. The
// project's `build` script (`frontmcp build`) builds the config's deployments
// instead — typically node — and never writes `.vercel/output`.
const VERCEL_BUILD = 'frontmcp build --target vercel';

const PACKAGE_MANAGERS: Record<VercelPackageManager, PackageManagerConfig> = {
  bun: { install: 'bun install', exec: 'bunx' },
  pnpm: { install: 'pnpm install', exec: 'pnpm exec' },
  yarn: { install: 'yarn install', exec: 'yarn' },
  npm: { install: 'npm install', exec: 'npx' },
};


/**
 * The `vercel.json` a FrontMCP project deploys with: install with the project's
 * package manager, then build the vercel target (which writes the Build Output
 * API tree Vercel serves).
 */
export function buildVercelJson(pm: VercelPackageManager): {
  version: 2;
  buildCommand: string;
  installCommand: string;
} {
  const config = PACKAGE_MANAGERS[pm];
  return {
    version: 2,
    buildCommand: `${config.exec} ${VERCEL_BUILD}`,
    installCommand: config.install,
  };
}
