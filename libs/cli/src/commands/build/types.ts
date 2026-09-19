import type { DeploymentTarget } from '../../config/frontmcp-config.types';

/**
 * Build-time facts an adapter may need that aren't part of the deployment
 * entry itself. Passed to `getSetupTemplate` so a target can reconcile CLI-side
 * configuration with what the server will actually read at runtime (#539).
 */
export type AdapterBuildContext = {
  /**
   * `transport.http.path` from `frontmcp.config.*`, when declared. Configures
   * the CLI (dev, inspector, generated client URLs); adapters use it to supply
   * the server's `http.entryPath` default so one declaration drives both.
   */
  transportHttpPath?: string;
};

/** Outcome of reconciling an existing platform config file with the build. */
export type AdapterConfigMerge = {
  /** Full contents to write back. */
  content: string;
  /** Notes the build should print (e.g. a value the build declined to change). */
  warnings: string[];
};

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
  getSetupTemplate?: (context?: AdapterBuildContext) => string;

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
   * @param deployment - Resolved `frontmcp.config.deployments[]` entry for this
   *   target, when one was found. Adapters that opt in (e.g., cloudflare)
   *   merge platform-specific fields (`wrangler.name`, `compatibilityDate`)
   *   into their generated config so values declared in `frontmcp.config.js`
   *   actually reach the platform — see #374.
   * @returns Object (for JSON) or string (for TOML/YAML)
   */
  getConfig?: (cwd: string, deployment?: DeploymentTarget) => object | string;

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
   *   when the entry exports a plain config object or the decorator's
   *   value evaluates to undefined at module-load time (e.g., env-gated
   *   ternaries that resolve to undefined when the env isn't set).
   * @param info - Round-2 (#375): structural metadata about the entry source.
   *   `info.keysSeenInSource` lists the top-level property names that appear
   *   in `@FrontMcp({...})` arg expressions even when their values are
   *   conditional. Adapters can use this to reject incompatible options
   *   (e.g., `sqlite: process.env.X ? {...} : undefined`) that the runtime
   *   config alone can't catch.
   * @throws to abort the build with a user-facing message.
   */
  validate?: (
    decoratorConfig: Record<string, unknown> | undefined,
    info?: { keysSeenInSource: string[] },
  ) => void;

  /**
   * Reconcile an existing platform config file with this build instead of
   * replacing it. Called in place of `getConfig()` when the file already
   * exists and `alwaysWriteConfig` is set, so an adapter can rewrite only the
   * keys it owns and leave user-authored sections alone (#535).
   *
   * @param existing - Current file contents.
   * @param cwd - Current working directory.
   * @param deployment - Resolved `frontmcp.config.deployments[]` entry, if any.
   */
  mergeConfig?: (existing: string, cwd: string, deployment?: DeploymentTarget) => AdapterConfigMerge;

  /**
   * Whether `getConfig()` output should overwrite an existing config file
   * (e.g., wrangler.toml) on every build. When false, an existing file is
   * left untouched but its contents are diffed against the build output and
   * the build fails on mismatch (#374). Default: false (preserve existing).
   */
  alwaysWriteConfig?: boolean;
};

export type AdapterName = 'node' | 'vercel' | 'lambda' | 'cloudflare' | 'distributed';
