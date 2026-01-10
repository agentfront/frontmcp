import * as yaml from 'js-yaml';
import * as path from 'path';
import { z } from 'zod';
import { readFile, fileExists } from '@frontmcp/utils';
import { loadEnvFiles, mapEnvToNestedConfig, extractSchemaPaths, populateProcessEnv } from './env-loader';
import { ConfigValidationError } from './config.service';

/**
 * Options for the config loader.
 */
export interface ConfigLoaderOptions {
  /** Base path for resolving files (default: process.cwd()) */
  basePath?: string;
  /** Path to .env file (default: '.env') */
  envPath?: string;
  /** Path to local override file (default: '.env.local') */
  localEnvPath?: string;
  /** Path to YAML config file (default: 'config.yml') */
  configPath?: string;
  /** Whether to load .env files (default: true) */
  loadEnv?: boolean;
  /** Whether to load YAML config (default: false - opt-in) */
  loadYaml?: boolean;
  /** Whether to populate process.env (default: true) */
  populateProcessEnv?: boolean;
}

/**
 * Load configuration from multiple sources and merge.
 * Priority: env > yaml > schema defaults
 *
 * @param schema - Zod schema defining the configuration structure
 * @param options - Loader options
 * @returns Validated and merged configuration
 */
export async function loadConfig<T extends object>(
  schema: z.ZodType<T>,
  options: ConfigLoaderOptions = {},
): Promise<T> {
  const {
    basePath = process.cwd(),
    envPath = '.env',
    localEnvPath = '.env.local',
    configPath = 'config.yml',
    loadEnv = true,
    loadYaml = false,
    populateProcessEnv: shouldPopulate = true,
  } = options;

  // Start with empty config (schema defaults will fill gaps)
  let config: Record<string, unknown> = {};

  // 1. Load YAML config file (lowest priority after defaults)
  if (loadYaml) {
    const yamlConfig = await loadYamlConfig(basePath, configPath);
    config = deepMerge(config, yamlConfig);
  }

  // 2. Load environment variables (highest priority)
  if (loadEnv) {
    // Load .env files
    const envFromFiles = await loadEnvFiles(basePath, envPath, localEnvPath);

    // Populate process.env if requested
    if (shouldPopulate) {
      populateProcessEnv(envFromFiles, false);
    }

    // Merge with process.env (process.env takes precedence)
    const allEnv = { ...envFromFiles };
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        allEnv[key] = value;
      }
    }

    // Map flat env vars to nested structure using schema paths
    const paths = extractSchemaPaths(schema);
    const envConfig = mapEnvToNestedConfig(allEnv, paths);
    config = deepMerge(config, envConfig);
  }

  // 3. Parse with schema (applies defaults and validates)
  const result = schema.safeParse(config);
  if (!result.success) {
    throw new ConfigValidationError('Configuration validation failed', result.error);
  }

  return result.data;
}

/**
 * Load and parse a YAML config file.
 */
async function loadYamlConfig(basePath: string, configPath: string): Promise<Record<string, unknown>> {
  // Try multiple extensions
  const extensions = ['', '.yml', '.yaml'];
  const baseName = configPath.replace(/\.(ya?ml)$/, '');

  for (const ext of extensions) {
    const fullPath = path.resolve(basePath, baseName + ext);

    if (await fileExists(fullPath)) {
      const content = await readFile(fullPath);
      const parsed = yaml.load(content);

      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
      return {};
    }
  }

  return {};
}

/**
 * Deep merge two objects, with source values taking precedence.
 * Arrays are replaced, not merged.
 */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };

  for (const key in source) {
    const sourceVal = source[key];
    const targetVal = result[key];

    if (sourceVal !== undefined && sourceVal !== null) {
      if (
        typeof sourceVal === 'object' &&
        !Array.isArray(sourceVal) &&
        typeof targetVal === 'object' &&
        !Array.isArray(targetVal) &&
        targetVal !== null
      ) {
        // Both are objects - deep merge
        result[key] = deepMerge(targetVal as Record<string, unknown>, sourceVal as Record<string, unknown>);
      } else {
        // Replace value
        result[key] = sourceVal;
      }
    }
  }

  return result;
}

export { deepMerge };
