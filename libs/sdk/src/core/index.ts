// file: libs/sdk/src/core/index.ts
/**
 * Platform-agnostic core exports for @frontmcp/sdk.
 *
 * This entry point exports only code that works in both Node.js and browser
 * environments. It does NOT include:
 * - Express adapter (Node.js HTTP server)
 * - SSE/HTTP transports (require HTTP server)
 * - Auth modules (Redis, JWT, JWKS)
 * - FrontMcpInstance (uses Express by default)
 *
 * Browser code should import from '@frontmcp/sdk/core' instead of '@frontmcp/sdk'.
 *
 * @example Browser initialization
 * ```typescript
 * import { initializeConfig, generateUUID } from '@frontmcp/sdk/core';
 *
 * // Required in browser - must be called before using SDK patterns
 * initializeConfig({
 *   debug: location.hostname === 'localhost',
 *   isDevelopment: location.hostname === 'localhost',
 *   machineId: generateUUID(),
 * });
 * ```
 *
 * @example Browser scope with SDK patterns
 * ```typescript
 * import { RegistryAbstract, ToolEntry, ProviderScope } from '@frontmcp/sdk/core';
 *
 * // Use SDK registry patterns in browser
 * class MyBrowserToolRegistry extends RegistryAbstract { ... }
 * ```
 */

// =============================================================================
// Platform Utilities (Web Crypto API)
// =============================================================================

export { generateUUID, getRandomBytes, getRandomHex, sha256, sha256Sync, simpleHash } from '../utils/platform-crypto';

// =============================================================================
// Runtime Configuration
// =============================================================================

export {
  type RuntimeConfig,
  initializeConfig,
  getConfig,
  getConfigValue,
  isConfigInitialized,
  resetConfig,
  isBrowserEnvironment,
  isNodeEnvironment,
  isWebWorkerEnvironment,
} from '../config';

// =============================================================================
// Registry Base
// =============================================================================

export { RegistryAbstract, type RegistryBuildMapResult } from '../regsitry';

// =============================================================================
// Entry Base Classes
// =============================================================================

export { ToolEntry } from '../common/entries/tool.entry';
export { ResourceEntry } from '../common/entries/resource.entry';
export { PromptEntry } from '../common/entries/prompt.entry';
export { BaseEntry } from '../common/entries/base.entry';

// =============================================================================
// Transport Base
// =============================================================================

export {
  TransportAdapterBase,
  type TransportAdapterBaseOptions,
  type JSONRPCMessage,
  type JSONRPCRequest,
  type JSONRPCResponse,
  type JSONRPCNotification,
  type MessageHandler,
  type ConnectionState,
  isJSONRPCRequest,
  isJSONRPCResponse,
  isJSONRPCNotification,
} from '../transport/adapters';

// =============================================================================
// Host Adapters
// =============================================================================

export { HostServerAdapter, NoOpHostAdapter } from '../server/adapters';

// =============================================================================
// Error Classes
// =============================================================================

export {
  McpError,
  PublicMcpError,
  InternalMcpError,
  ToolNotFoundError,
  ResourceNotFoundError,
  ResourceReadError,
  InvalidResourceUriError,
  InvalidInputError,
  InvalidOutputError,
  InvalidMethodError,
  ToolExecutionError,
  RateLimitError,
  QuotaExceededError,
  UnauthorizedError,
  GenericServerError,
  DependencyNotFoundError,
  InvalidHookFlowError,
  PromptNotFoundError,
  PromptExecutionError,
  isPublicError,
  toMcpError,
  formatMcpErrorResponse,
  MCP_ERROR_CODES,
  type McpErrorCode,
} from '../errors';

// =============================================================================
// Common Types (Metadata)
// =============================================================================

export type {
  ToolMetadata,
  ToolInputType,
  ToolOutputType,
  ResourceMetadata,
  ResourceTemplateMetadata,
  PromptMetadata,
} from '../common/metadata';

// =============================================================================
// Common Types (Records)
// =============================================================================

export type {
  ToolRecord,
  ResourceRecord,
  ResourceTemplateRecord,
  AnyResourceRecord,
  PromptRecord,
} from '../common/records';

// =============================================================================
// Utility Functions
// =============================================================================

export {
  // URI utilities
  isValidMcpUri,
  extractUriScheme,
  isValidMcpUriTemplate,
  parseUriTemplate,
  matchUriTemplate,
  expandUriTemplate,
} from '../utils';

// =============================================================================
// Scope (for dependency injection)
// =============================================================================

export { Scope } from '../scope';

// =============================================================================
// Re-export MCP types commonly needed
// =============================================================================

export type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

// =============================================================================
// Platform Abstraction (for browser compatibility)
// =============================================================================

export type {
  PlatformCrypto,
  PlatformStorage,
  PlatformContextStorage,
  PlatformConfig,
  PlatformLogger,
} from '../platform';

// =============================================================================
// Provider Types (for DI patterns)
// =============================================================================

export { ProviderScope } from '../common/metadata/provider.metadata';

export { ProviderKind } from '../common/records/provider.record';

export type { Token, Type, Ctor, Reference } from '../common/interfaces/base.interface';

export type {
  ProviderInterface,
  ProviderType,
  ProviderClassType,
  ProviderValueType,
  ProviderFactoryType,
} from '../common/interfaces/provider.interface';

export type {
  ProviderRecord,
  ProviderClassRecord,
  ProviderValueRecord,
  ProviderFactoryRecord,
  ProviderClassTokenRecord,
} from '../common/records/provider.record';

export type {
  ProviderViews,
  ProviderRegistryInterface,
  RegistryKind,
} from '../common/interfaces/internal/registry.interface';

export type { EntryOwnerRef, EntryOwnerKind, EntryLineage } from '../common/entries/base.entry';

// =============================================================================
// Human-in-the-Loop (HiTL)
// =============================================================================

export {
  HitlManager,
  createHitlManager,
  withConfirmation,
  RequiresConfirmation,
  hasConfirmationRequirement,
  getConfirmationOptions,
  createConfirmationBatch,
  DEFAULT_HITL_CONFIG,
  RISK_LEVEL_CONFIG,
  compareRiskLevels,
  isRiskLevelAtOrAbove,
  type HitlManagerOptions,
  type WithConfirmationOptions,
  type ConfirmedToolResult,
  type ConfirmationDecision,
  type RiskLevel,
  type ConfirmationRequest,
  type ConfirmationResponse,
  type RememberedDecision,
  type AuditLogEntry,
  type BypassRule,
  type ConfirmationHandler,
  type HitlConfig,
} from '../hitl';

// =============================================================================
// Plugin System (for browser plugin support)
// =============================================================================

export { FrontMcpPlugin, Plugin } from '../common/decorators/plugin.decorator';
export { DynamicPlugin } from '../common/dynamic/dynamic.plugin';
export type { PluginMetadata } from '../common/metadata/plugin.metadata';
export type {
  PluginInterface,
  PluginType,
  PluginClassType,
  PluginValueType,
  PluginFactoryType,
} from '../common/interfaces/plugin.interface';
export type { PluginRecord } from '../common/records/plugin.record';
export { PluginKind } from '../common/records/plugin.record';
export { PluginEntry } from '../common/entries/plugin.entry';

// Hook types (simplified for browser - full flow hooks require SDK flows)
export type { HookMetadata, HookStageType, HookOptions } from '../common/metadata/hook.metadata';

export { ToolHookStage } from '../common/interfaces/tool-hook.interface';
