/**
 * HA Constants — Default Values
 *
 * These are defaults that can be overridden via `frontmcp.config`.
 * The deployment config file sets the actual values at build time.
 */

/** Default cookie name for LB session affinity routing. */
export const DEFAULT_FRONTMCP_NODE_COOKIE = '__frontmcp_node';

/** Default response header exposing the current pod's machine ID. */
export const DEFAULT_FRONTMCP_MACHINE_ID_HEADER = 'X-FrontMCP-Machine-Id';
