/**
 * @file index.ts
 * @description Barrel exports for MCP Jest matchers
 */

export { mcpMatchers } from './mcp-matchers';

// Re-export types for convenience
export type { McpMatchers } from './matcher-types';

// Import the type augmentation to make TypeScript aware of the matchers
import './matcher-types';
