// Plugin/global Tool hooks (method-level) metadata key
// Stored on plugin classes by @ToolHook decorator
export const MCP_SESSION_HOOKS = 'mcp.plugin.sessionHooks';
export const MCP_AUTH_HOOKS = 'mcp.plugin.sessionHooks';

// Metadata keys for async dependency injection
export const META_ASYNC_WITH = Symbol('mcp.asyncWith');
export const META_ASYNC_WITH_TOKENS = Symbol('mcp.asyncWithTokens');

// Reflect metadata key for design:paramtypes
export const DESIGN_PARAMTYPES = 'design:paramtypes';
