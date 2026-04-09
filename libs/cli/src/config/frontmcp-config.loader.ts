/**
 * FrontMCP Config Loader
 *
 * Loads `frontmcp.config.(json|js|ts|mjs|cjs)` from a directory.
 * Falls back to deriving minimal config from package.json.
 */

import * as fs from 'fs';
import * as path from 'path';

import { frontmcpConfigSchema, type FrontMcpConfigParsed } from './frontmcp-config.schema';
import type { DeploymentTarget, FrontMcpConfig } from './frontmcp-config.types';

const CONFIG_FILENAMES = [
  'frontmcp.config.ts',
  'frontmcp.config.js',
  'frontmcp.config.json',
  'frontmcp.config.mjs',
  'frontmcp.config.cjs',
];

/**
 * Load and validate a frontmcp.config file from the given directory.
 *
 * Resolution order:
 * 1. frontmcp.config.ts
 * 2. frontmcp.config.js
 * 3. frontmcp.config.json
 * 4. frontmcp.config.mjs
 * 5. frontmcp.config.cjs
 * 6. Derive from package.json (minimal config with 'node' target)
 */
export async function loadFrontMcpConfig(cwd: string): Promise<FrontMcpConfigParsed> {
  const raw = await loadRawConfig(cwd);
  return validateConfig(raw);
}

/**
 * Load raw config without validation.
 */
async function loadRawConfig(cwd: string): Promise<unknown> {
  for (const filename of CONFIG_FILENAMES) {
    const configPath = path.join(cwd, filename);
    if (!fs.existsSync(configPath)) continue;

    if (filename.endsWith('.json')) {
      const content = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(content);
    }

    if (filename.endsWith('.ts')) {
      // TypeScript config — try tsx or ts-node for runtime loading
      try {
        const mod = require(configPath);
        return mod.default ?? mod;
      } catch {
        // If require fails (no ts-node), try dynamic import
        const mod = await import(configPath);
        return mod.default ?? mod;
      }
    }

    // JS/MJS/CJS
    if (filename.endsWith('.mjs')) {
      const mod = await import(configPath);
      return mod.default ?? mod;
    }

    const mod = require(configPath);
    return mod.default ?? mod;
  }

  // Fallback: derive from package.json
  return deriveFromPackageJson(cwd);
}

/**
 * Derive minimal config from package.json.
 */
function deriveFromPackageJson(cwd: string): FrontMcpConfig {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error(
      'No frontmcp.config found and no package.json. Create a frontmcp.config.ts to configure build targets.',
    );
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  return {
    name: pkg.name?.replace(/^@[^/]+\//, '') || path.basename(cwd),
    version: pkg.version || '1.0.0',
    entry: pkg.main,
    deployments: [{ target: 'node' }],
  };
}

/**
 * Validate raw config against the Zod schema.
 */
export function validateConfig(raw: unknown): FrontMcpConfigParsed {
  const result = frontmcpConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid frontmcp.config:\n${issues}`);
  }
  return result.data;
}

/**
 * Find a deployment target by type.
 */
export function findDeployment(config: FrontMcpConfigParsed, target: string): DeploymentTarget | undefined {
  return config.deployments.find((d) => d.target === target);
}

/**
 * Get all deployment target types from the config.
 */
export function getDeploymentTargets(config: FrontMcpConfigParsed): string[] {
  return config.deployments.map((d) => d.target);
}
