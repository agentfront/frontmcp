export const MCP_BASE_METADATA = {
  NAME: 'name',
  DESCRIPTION: 'description',
};

export const MCP_APP_METADATA = {
  ...MCP_BASE_METADATA,
  PROVIDERS: 'providers',
  ADAPTERS: 'adapters',
  PLUGINS: 'plugins',
  TOOLS: 'tools',
};

export const MCP_PROVIDER_METADATA = {
  ...MCP_BASE_METADATA,
  SCOPE: 'scope',
};


export const MCP_TOOL_METADATA = {
  ID: 'id',
  NAME: 'name',
  DESCRIPTION: 'description',
  INPUT_SCHEMA: 'inputSchema',
  OUTPUT_SCHEMA: 'outputSchema',
};

// Plugin/global Tool hooks (method-level) metadata key
// Stored on plugin classes by @ToolHook decorator
export const MCP_TOOL_HOOKS = 'mcp.plugin.toolHooks';
export const MCP_SESSION_HOOKS = 'mcp.plugin.sessionHooks';
export const MCP_AUTH_HOOKS = 'mcp.plugin.sessionHooks';


// Common metadata keys used across the project
export const DESIGN_PARAMTYPES = 'design:paramtypes';
// Alias for app metadata providers key to standardize usage in core/common
export const META_PROVIDERS = MCP_APP_METADATA.PROVIDERS;
export const META_ADAPTERS = MCP_APP_METADATA.ADAPTERS;
