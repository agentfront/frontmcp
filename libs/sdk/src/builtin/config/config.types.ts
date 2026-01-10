import { z } from 'zod';

/**
 * Options for ConfigPlugin initialization.
 */
export interface ConfigPluginOptions<TConfig extends object = Record<string, string>> {
  /**
   * Zod schema defining the configuration structure.
   * When provided, enables:
   * - Type inference for config paths
   * - Automatic env var mapping (database.url -> DATABASE_URL)
   * - Schema validation with defaults
   */
  schema?: z.ZodType<TConfig>;

  /**
   * Path to the .env file.
   * @default '.env'
   */
  envPath?: string;

  /**
   * Path to local override file.
   * Local file takes precedence over base env file.
   * @default '.env.local'
   */
  localEnvPath?: string;

  /**
   * Path to YAML config file.
   * @default 'config.yml'
   */
  configPath?: string;

  /**
   * Whether to load .env files.
   * Set to false if env is already loaded (e.g., by CLI).
   * @default true
   */
  loadEnv?: boolean;

  /**
   * Whether to load YAML config file.
   * @default false
   */
  loadYaml?: boolean;

  /**
   * Whether to populate process.env with loaded values.
   * @default true
   */
  populateProcessEnv?: boolean;

  /**
   * Whether to throw on validation errors.
   * @default true
   */
  strict?: boolean;

  /**
   * Base path for resolving .env and config files.
   * @default process.cwd()
   */
  basePath?: string;
}

/**
 * Input options (what users provide to init()).
 * All fields are optional since we have defaults.
 */
export type ConfigPluginOptionsInput<T extends object = Record<string, string>> = Partial<ConfigPluginOptions<T>>;

/**
 * Parsed and validated environment configuration.
 */
export interface ParsedEnvConfig {
  /** Raw environment variables (string values) */
  raw: Record<string, string>;
  /** Parsed values (if schema provided) */
  parsed?: Record<string, unknown>;
}
