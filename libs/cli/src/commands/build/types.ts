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
   * Generate the deployment platform config file content.
   * @returns Object (for JSON) or string (for TOML/YAML)
   */
  getConfig?: () => object | string;

  /** Name of the config file (e.g., 'vercel.json', 'wrangler.toml') */
  configFileName?: string;
};

export type AdapterName = 'node' | 'vercel' | 'lambda' | 'cloudflare';
