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
   * @param cwd - Current working directory (for detecting package manager, etc.)
   * @returns Object (for JSON) or string (for TOML/YAML)
   */
  getConfig?: (cwd: string) => object | string;

  /** Name of the config file (e.g., 'vercel.json', 'wrangler.toml') */
  configFileName?: string;

  /**
   * Post-bundle hook for creating deployment-specific output structure.
   * Called after bundling is complete.
   * @param outDir - The output directory (e.g., 'dist')
   * @param cwd - Current working directory
   * @param bundleOutput - Name of the bundled file (e.g., 'handler.cjs')
   */
  postBundle?: (outDir: string, cwd: string, bundleOutput: string) => Promise<void>;

  /**
   * Pre-build validation hook. Runs after schema/decorator extraction but
   * before TypeScript compilation. Allows the adapter to fail loudly when
   * the user's config references runtime features that won't work on the
   * target platform (e.g., sqlite on Cloudflare Workers).
   *
   * @param decoratorConfig - Best-effort `__frontmcp:config` metadata
   *   extracted from the entry's @FrontMcp() decorator. May be undefined
   *   when the entry exports a plain config object.
   * @throws to abort the build with a user-facing message.
   */
  validate?: (decoratorConfig: Record<string, unknown> | undefined) => void;

  /**
   * Whether `getConfig()` output should overwrite an existing config file
   * (e.g., wrangler.toml) on every build. When false, an existing file is
   * left untouched but its contents are diffed against the build output and
   * the build fails on mismatch (#374). Default: false (preserve existing).
   */
  alwaysWriteConfig?: boolean;
};

export type AdapterName = 'node' | 'vercel' | 'lambda' | 'cloudflare' | 'distributed';
