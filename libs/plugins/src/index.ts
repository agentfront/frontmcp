/**
 * @frontmcp/plugins - Meta-package for FrontMCP plugins
 *
 * This package re-exports all official FrontMCP plugins for convenience.
 * You can also install individual plugins directly:
 *
 * - @frontmcp/plugin-cache
 * - @frontmcp/plugin-codecall
 * - @frontmcp/plugin-dashboard
 * - @frontmcp/plugin-remember
 */

// Cache Plugin
export { default as CachePlugin, CachePluginOptions } from '@frontmcp/plugin-cache';

// CodeCall Plugin
export {
  default as CodeCallPlugin,
  CodeCallPluginOptions,
  CodeCallPluginOptionsInput,
} from '@frontmcp/plugin-codecall';

// Dashboard Plugin
export {
  default as DashboardPlugin,
  DashboardApp,
  DashboardPluginOptions,
  DashboardPluginOptionsInput,
} from '@frontmcp/plugin-dashboard';

// Remember Plugin
export {
  RememberPlugin,
  RememberPluginOptions,
  RememberPluginOptionsInput,
  RememberAccessorToken,
  ApprovalServiceToken,
  RememberScope,
  ApprovalScope,
  ApprovalState,
} from '@frontmcp/plugin-remember';
export type { RememberEntry, ApprovalRecord, ToolApprovalRequirement } from '@frontmcp/plugin-remember';
