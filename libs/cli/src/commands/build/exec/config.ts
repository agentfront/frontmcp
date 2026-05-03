/**
 * frontmcp.config.js/json schema and loader.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { SetupDefinition } from './setup';

export interface OAuthConfig {
  serverUrl?: string;
  clientId?: string;
  defaultScope?: string;
  portRange?: [number, number];
  defaultPort?: number;
  timeout?: number;
}

export interface CliConfig {
  enabled: boolean;
  outputDefault?: 'text' | 'json';
  authRequired?: boolean;
  description?: string;
  excludeTools?: string[];
  nativeDeps?: {
    brew?: string[];
    apt?: string[];
    npm?: string[];
  };
  oauth?: OAuthConfig;
}

export type ConfigBuildTarget = 'cli' | 'node' | 'sdk' | 'browser' | 'cloudflare' | 'vercel' | 'lambda' | 'distributed';

export interface FrontmcpExecConfig {
  name: string;
  version?: string;
  entry?: string;
  /** Build target. When set, takes precedence over cli.enabled / sea.enabled. */
  target?: ConfigBuildTarget;
  storage?: {
    type: 'sqlite' | 'redis' | 'none';
    required?: boolean;
  };
  network?: {
    defaultPort?: number;
    supportsSocket?: boolean;
  };
  dependencies?: {
    system?: string[];
    nativeAddons?: string[];
  };
  nodeVersion?: string;
  esbuild?: {
    external?: string[];
    define?: Record<string, string>;
    target?: string;
    minify?: boolean;
  };
  setup?: SetupDefinition;
  cli?: CliConfig;
  sea?: {
    enabled?: boolean;
  };
}

const CONFIG_FILENAMES = [
  // #365 round-3 — `.ts` is checked first so the user's typed config takes
  // priority over a stale `.js` left in the project. `.ts` loading routes
  // through the same esbuild path as the new-shape loader so it works under
  // `"type": "commonjs"` (Node's `require(.ts)` and `await import(.ts)` are
  // both unreliable here and were the root cause of #365 1.1.0–1.1.2-beta.1).
  'frontmcp.config.ts',
  'frontmcp.config.js',
  'frontmcp.config.json',
  'frontmcp.config.mjs',
  'frontmcp.config.cjs',
];

/**
 * Load frontmcp.config.{ts,js,json,mjs,cjs} from the given directory.
 * Falls back to deriving minimal config from package.json.
 */
export async function loadExecConfig(cwd: string): Promise<FrontmcpExecConfig> {
  for (const filename of CONFIG_FILENAMES) {
    const configPath = path.join(cwd, filename);
    if (fs.existsSync(configPath)) {
      if (filename.endsWith('.json')) {
        const content = fs.readFileSync(configPath, 'utf-8');
        return JSON.parse(content) as FrontmcpExecConfig;
      }
      if (filename.endsWith('.ts')) {
        // Delegate to the new loader's esbuild transpile so `.ts` configs
        // work under `"type": "commonjs"` projects. Hard-fails on parse error
        // (no silent default) — matches frontmcp-config.loader semantics.
        // tsc uses `--moduleResolution nodenext`, so the dynamic import
        // needs an explicit `.js` suffix that resolves to the compiled
        // output. The barrel (`../../../config/index.js`) re-exports
        // `loadFrontMcpConfig` from the loader module.
        const { loadFrontMcpConfig } = await import('../../../config/index.js');
        try {
          // The new-shape loader returns a parsed config — we only consume the
          // legacy-shape fields here. Fields that exist in both shapes
          // (name, version, entry, nodeVersion) carry through; new-shape-only
          // fields like `deployments` are ignored by this consumer.
          const newShape = await loadFrontMcpConfig(cwd);
          return newShape as unknown as FrontmcpExecConfig;
        } catch (err) {
          throw new Error(
            `Failed to load ${filename}: ${(err as Error).message}\n` +
              `If your config doesn't match the new schema (deployments[] etc.), ` +
              `rename it to .js or use the legacy module.exports shape.`,
          );
        }
      }
      // JS/MJS/CJS config — require it

      const mod = require(configPath);
      return (mod.default || mod) as FrontmcpExecConfig;
    }
  }

  // Fallback: derive from package.json
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error(
      'No frontmcp.config.js/json found and no package.json. Create a frontmcp.config.js for build targets.',
    );
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  return {
    name: pkg.name?.replace(/^@[^/]+\//, '') || path.basename(cwd),
    version: pkg.version || '1.0.0',
    entry: pkg.main,
  };
}

/**
 * Validate config and return normalized version.
 */
export function normalizeConfig(config: FrontmcpExecConfig): Required<
  Pick<FrontmcpExecConfig, 'name' | 'version' | 'nodeVersion'>
> &
  FrontmcpExecConfig {
  if (!config.name || !/^[a-zA-Z0-9._-]+$/.test(config.name)) {
    throw new Error(
      `Invalid app name: "${config.name}". Must be alphanumeric with .-_ only.`,
    );
  }

  return {
    ...config,
    name: config.name,
    version: config.version || '1.0.0',
    nodeVersion: config.nodeVersion || '>=22.0.0',
  };
}
