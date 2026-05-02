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
      // #365 — When the project is `"type": "commonjs"` (the default),
      // `require()` can't load .ts (no transpiler) and `await import()`
      // fails with "Make sure to set 'type': 'module'". The previous loader
      // silently fell through to defaults. Now we transpile the .ts file
      // with esbuild (already a dependency) and eval the resulting CJS.
      // Any failure throws — no silent fallback.
      try {
        const mod = require(configPath);
        return mod.default ?? mod;
      } catch (requireErr) {
        try {
          const mod = await import(configPath);
          return mod.default ?? mod;
        } catch {
          // Both runtime loaders rejected — fall through to esbuild transpile.
        }
        try {
          return await loadTsConfigViaEsbuild(configPath);
        } catch (esbuildErr) {
          throw new Error(
            `Failed to load ${filename}.\n` +
              `  require() error: ${(requireErr as Error).message}\n` +
              `  esbuild error:   ${(esbuildErr as Error).message}\n` +
              `Hint: ensure the file exports a default config (e.g., ` +
              `\`export default defineConfig({...})\`) and that all imports resolve.`,
          );
        }
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
 * Transpile a TypeScript config file with esbuild (CJS target) and eval the
 * result via Module-via-vm. Used as a last-resort path when neither `require()`
 * (no ts-node hook) nor `await import()` (project is `"type": "commonjs"`)
 * can load the file directly.
 */
async function loadTsConfigViaEsbuild(configPath: string): Promise<unknown> {
  const esbuild = require('esbuild') as typeof import('esbuild');
  const source = fs.readFileSync(configPath, 'utf-8');
  const transformed = esbuild.transformSync(source, {
    loader: 'ts',
    format: 'cjs',
    target: 'es2022',
    sourcefile: configPath,
  });

  const Module = require('module') as typeof import('module');
  const m = new Module(configPath, module);
  // Make the loaded module's `require` resolve relative to the config dir
  // so user `import { defineConfig } from 'frontmcp'` keeps working.
  m.filename = configPath;
  m.paths = (Module as unknown as { _nodeModulePaths(p: string): string[] })._nodeModulePaths(path.dirname(configPath));

  (m as any)._compile(transformed.code, configPath);

  const exported = (m as any).exports as { default?: unknown };
  return exported?.default ?? exported;
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
