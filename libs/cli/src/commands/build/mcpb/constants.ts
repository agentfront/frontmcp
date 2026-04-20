/**
 * MCPB (MCP Bundles) constants — spec v0.3
 * https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md
 */

/** Spec version emitted in every generated manifest. */
export const MCPB_MANIFEST_VERSION = '0.3';

/** Default Node.js version constraint for the bundled runtime. */
export const DEFAULT_NODE_COMPAT = '>=22.0.0';

/** Default compatibility platforms when none are declared. */
export const DEFAULT_PLATFORMS = ['darwin', 'linux', 'win32'] as const;

/** Whitelist of variable substitutions allowed inside mcp_config fields. */
export const ALLOWED_SUBSTITUTION_VARS = new Set([
  '__dirname',
  'HOME',
  'DESKTOP',
  'DOCUMENTS',
  'DOWNLOADS',
  'pathSeparator',
  '/', // alias for pathSeparator
]);

/** Prefix that indicates a user_config reference (${user_config.KEY}). */
export const USER_CONFIG_PREFIX = 'user_config.';

/** Deterministic mtime applied to every archive entry for reproducible builds. */
export const DETERMINISTIC_MTIME = new Date('2000-01-01T00:00:00Z');

/** Platform keys recognized by MCPB platform_overrides. */
export type McpbPlatformKey =
  | 'darwin-arm64'
  | 'darwin-x64'
  | 'linux-arm64'
  | 'linux-x64'
  | 'win32-x64';

/** Archive size warning thresholds (bytes). */
export const ARCHIVE_SIZE_WARN = 50 * 1024 * 1024; // 50 MB
export const ARCHIVE_SIZE_ERROR = 100 * 1024 * 1024; // 100 MB
