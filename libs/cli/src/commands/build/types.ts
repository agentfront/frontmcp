/**
 * Configuration for a deployment adapter.
 * Each adapter defines how to compile and package the FrontMCP server
 * for a specific deployment target.
 */
export type AdapterTemplate = {
  /** Module format for TypeScript compilation */
  moduleFormat: 'commonjs' | 'esnext';

  /**
   * Generate the entry point file content.
   * @param mainModulePath - Relative path to the compiled main module (e.g., './main.js')
   * @returns The content for index.js, or empty string if no wrapper needed
   */
  getEntryTemplate: (mainModulePath: string) => string;

  /**
   * Generate the serverless setup file content.
   * This file is imported first to set environment variables before decorators run.
   * @returns The content for serverless-setup.js, or undefined if not needed
   */
  getSetupTemplate?: () => string;

  /**
   * Whether to bundle the output with rspack.
   * Recommended for serverless deployments to avoid ESM/CJS issues.
   */
  shouldBundle?: boolean;

  /**
   * Output filename for the bundled file (e.g., 'handler.cjs').
   * Only used when shouldBundle is true.
   */
  bundleOutput?: string;

  /**
   * Generate the deployment platform config file content.
   * @returns Object (for JSON) or string (for TOML/YAML)
   */
  getConfig?: () => object | string;

  /** Name of the config file (e.g., 'vercel.json', 'wrangler.toml') */
  configFileName?: string;
};

export type AdapterName = 'node' | 'vercel' | 'lambda' | 'cloudflare';
