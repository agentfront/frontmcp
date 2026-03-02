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
 *
 * MIGRATION: ConfigPlugin has been moved to @frontmcp/sdk.
 * The @frontmcp/plugin-config package is no longer available.
 * Import directly from the SDK: `import { ConfigPlugin } from '@frontmcp/sdk'`
 * See docs/draft/docs/extensibility/config-yaml.mdx for migration details.
 */

export * from '@frontmcp/plugin-approval';
export * from '@frontmcp/plugin-cache';
export * from '@frontmcp/plugin-codecall';
export * from '@frontmcp/plugin-dashboard';
export * from '@frontmcp/plugin-remember';
