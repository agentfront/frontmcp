/**
 * Consent Flow Types and Schemas
 *
 * Defines types for the tool consent flow that allows users to select
 * which MCP tools they want to expose to the LLM.
 */
import { z } from 'zod';
import { consentConfigSchema } from '../../common';

// ============================================
// Consent Configuration Schemas
// ============================================

/**
 * Tool consent item schema - represents a tool available for consent
 */
export const consentToolItemSchema = z.object({
  /** Tool ID (e.g., 'slack:send_message') */
  id: z.string().min(1),
  /** Tool name for display */
  name: z.string().min(1),
  /** Tool description */
  description: z.string().optional(),
  /** App ID this tool belongs to */
  appId: z.string().min(1),
  /** App name for display */
  appName: z.string().min(1),
  /** Whether the tool is selected by default */
  defaultSelected: z.boolean().default(true),
  /** Whether this tool requires specific scopes */
  requiredScopes: z.array(z.string()).optional(),
  /** Category for grouping (e.g., 'read', 'write', 'admin') */
  category: z.string().optional(),
});

/**
 * Consent selection schema - user's tool selection
 */
export const consentSelectionSchema = z.object({
  /** Selected tool IDs */
  selectedTools: z.array(z.string()),
  /** Whether all tools were selected */
  allSelected: z.boolean(),
  /** Timestamp when consent was given */
  consentedAt: z.string().datetime(),
  /** Consent version for tracking changes */
  consentVersion: z.string().default('1.0'),
});

/**
 * Consent page state schema - stored in pending authorization
 */
export const consentStateSchema = z.object({
  /** Whether consent flow is enabled */
  enabled: z.boolean(),
  /** Available tools for consent */
  availableTools: z.array(consentToolItemSchema),
  /** Pre-selected tools (from previous consent or defaults) */
  preselectedTools: z.array(z.string()).optional(),
  /** Whether to show all tools or group by app */
  groupByApp: z.boolean().default(true),
  /** Custom consent message */
  customMessage: z.string().optional(),
});
// ============================================
// Federated Login Schemas
// ============================================

/**
 * Auth provider item for federated login UI
 */
export const federatedProviderItemSchema = z.object({
  /** Provider ID (derived or explicit) */
  id: z.string().min(1),
  /** Provider display name */
  name: z.string().min(1),
  /** Provider description */
  description: z.string().optional(),
  /** Provider icon URL or emoji */
  icon: z.string().optional(),
  /** Provider type */
  type: z.enum(['local', 'remote', 'transparent']),
  /** OAuth provider URL (for remote providers) */
  providerUrl: z.string().url().optional(),
  /** Apps using this provider */
  appIds: z.array(z.string()),
  /** App names using this provider */
  appNames: z.array(z.string()),
  /** Scopes required by this provider */
  scopes: z.array(z.string()),
  /** Whether this is the primary/parent provider */
  isPrimary: z.boolean(),
  /** Whether this provider is optional (can be skipped) */
  isOptional: z.boolean().default(false),
});

/**
 * Federated login state schema
 */
export const federatedLoginStateSchema = z.object({
  /** All available providers */
  providers: z.array(federatedProviderItemSchema),
  /** Primary provider ID (if any) */
  primaryProviderId: z.string().optional(),
  /** Whether user can skip optional providers */
  allowSkip: z.boolean().default(true),
  /** Pre-selected provider IDs (from previous session) */
  preselectedProviders: z.array(z.string()).optional(),
});

/**
 * Federated login selection schema
 */
export const federatedSelectionSchema = z.object({
  /** Selected provider IDs */
  selectedProviders: z.array(z.string()),
  /** Skipped provider IDs */
  skippedProviders: z.array(z.string()),
  /** Provider-specific metadata */
  providerMetadata: z.record(z.string(), z.unknown()).optional(),
});

// ============================================
// Type Exports
// ============================================

export type ConsentToolItem = z.infer<typeof consentToolItemSchema>;
export type ConsentSelection = z.infer<typeof consentSelectionSchema>;
export type ConsentState = z.infer<typeof consentStateSchema>;
export type ConsentConfig = z.infer<typeof consentConfigSchema>;
export type ConsentConfigInput = z.input<typeof consentConfigSchema>;

export type FederatedProviderItem = z.infer<typeof federatedProviderItemSchema>;
export type FederatedLoginState = z.infer<typeof federatedLoginStateSchema>;
export type FederatedSelection = z.infer<typeof federatedSelectionSchema>;
