/**
 * @file remote-mcp/index.ts
 * @description Barrel exports for the remote MCP module
 *
 * This module provides functionality for connecting to remote MCP servers
 * and exposing their capabilities (tools, resources, prompts) through
 * factory-created instances that integrate with the FrontMCP hook system.
 */

// MCP Client Service
export { McpClientService } from './mcp-client.service';

// Types
export type {
  // Connection types
  McpClientConnection,
  McpConnectionStatus,
  McpConnectionInfo,
  // Transport types
  McpTransportType,
  McpHttpTransportOptions,
  McpWorkerTransportOptions,
  McpEsmTransportOptions,
  McpTransportOptions,
  // Auth types
  McpStaticCredentials,
  McpRemoteAuthConfig,
  McpRemoteAuthContext,
  // Capability types
  McpRemoteCapabilities,
  McpCapabilityChangeEvent,
  // Service types
  McpClientServiceOptions,
  McpConnectRequest,
  McpRemoteCallToolResult,
  McpRemoteReadResourceResult,
  McpRemoteGetPromptResult,
  // Callback types
  McpCapabilityChangeCallback,
  McpConnectionChangeCallback,
  McpUnsubscribeFn,
} from './mcp-client.types';

// Cache
export { CapabilityCache, type CapabilityCacheConfig } from './cache';

// Resilience utilities for self-healing
export {
  // Retry
  withRetry,
  isTransientError,
  isConnectionError,
  isAuthError,
  type RetryOptions,
  // Circuit Breaker
  CircuitBreaker,
  CircuitBreakerManager,
  CircuitOpenError,
  type CircuitState,
  type CircuitBreakerOptions,
  // Health Check
  HealthChecker,
  HealthCheckManager,
  type HealthStatus,
  type HealthCheckResult,
  type HealthCheckOptions,
} from './resilience';

// Factory functions for creating remote instances
export {
  // Context factories - create dynamic context classes with closed-over dependencies
  createRemoteToolContextClass,
  createRemoteResourceContextClass,
  createRemotePromptContextClass,
  // Record builders - build standard records with factory-created context classes
  buildRemoteToolRecord,
  buildRemoteResourceRecord,
  buildRemoteResourceTemplateRecord,
  buildRemotePromptRecord,
  // Instance factories - create standard instances for remote entities
  createRemoteToolInstance,
  createRemoteResourceInstance,
  createRemoteResourceTemplateInstance,
  createRemotePromptInstance,
} from './factories';
