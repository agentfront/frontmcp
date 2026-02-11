/**
 * frontmcp.config.js/json schema and loader.
 */

import * as path from 'path';
import * as fs from 'fs';
import { SetupDefinition } from './setup';

export interface FrontmcpExecConfig {
  name: string;
  version?: string;
  entry?: string;
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
}

const CONFIG_FILENAMES = [
  'frontmcp.config.js',
  'frontmcp.config.json',
  'frontmcp.config.mjs',
  'frontmcp.config.cjs',
];

/**
 * Load frontmcp.config.js/json from the given directory.
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
      // JS/MJS/CJS config — require it
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(configPath);
      return (mod.default || mod) as FrontmcpExecConfig;
    }
  }

  // Fallback: derive from package.json
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error(
      'No frontmcp.config.js/json found and no package.json. Create a frontmcp.config.js to use --exec.',
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
