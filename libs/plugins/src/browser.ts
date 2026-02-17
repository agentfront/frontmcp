/**
 * @frontmcp/plugins - Browser Entry Point
 *
 * Meta-package re-exporting browser-compatible plugins.
 * Excludes plugin-codecall (requires VM sandbox and vector search — Node.js only).
 *
 * @packageDocumentation
 */

export * from '@frontmcp/plugin-cache/browser';
export * from '@frontmcp/plugin-dashboard/browser';
export * from '@frontmcp/plugin-remember/browser';
export * from '@frontmcp/plugin-approval/browser';
