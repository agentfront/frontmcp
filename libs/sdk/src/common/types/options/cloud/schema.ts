// common/types/options/cloud/schema.ts
// Zod schema for cloud (Frontegg) integration options

import { z } from '@frontmcp/lazy-zod';

import type { RawZodShape } from '../../common.types';
import type {
  CloudAppIntegrationOptions as CloudAppIntegrationOptionsInterface,
  CloudAppIntegrationPolicyOptions as CloudAppIntegrationPolicyOptionsInterface,
  CloudAppIntegrationSyncOptions as CloudAppIntegrationSyncOptionsInterface,
  CloudApprovalsOptions as CloudApprovalsOptionsInterface,
  CloudOptions as CloudOptionsInterface,
} from './interfaces';

export const cloudApprovalsOptionsSchema = z.object({
  mode: z.enum(['recheck', 'webhook']).optional().default('recheck'),
  webhookPath: z.string().optional().default('/cloud/approvals/callback'),
  pollIntervalMs: z.number().int().positive().optional().default(2000),
} satisfies RawZodShape<CloudApprovalsOptionsInterface>);

const approvalsDefaults = {
  mode: 'recheck' as const,
  webhookPath: '/cloud/approvals/callback',
  pollIntervalMs: 2000,
};

/**
 * Normalize the approvals union so consumers always see the object form
 * (never a bare boolean). `true` expands to full defaults; `false` expands
 * to `{ mode: 'recheck', ... }` with an internal `enabled: false` flag —
 * but since the public type forbids `enabled`, we encode disabled state as
 * an absent `enabled` / separate field in ResolvedApprovalsOptions at a
 * later layer. The plugin inspects this via the resolver.
 */
const approvalsNormalizedSchema = z
  .union([z.boolean(), cloudApprovalsOptionsSchema])
  .optional()
  .default(true)
  .transform((val) => {
    if (val === true) return { ...approvalsDefaults };
    if (val === false) return { ...approvalsDefaults, __disabled: true as const };
    return { ...approvalsDefaults, ...val };
  });

export const cloudAppIntegrationSyncOptionsSchema = z.object({
  mode: z.enum(['full', 'incremental', 'disabled']).optional().default('incremental'),
  entryTypes: z
    .array(z.enum(['tool', 'resource', 'prompt', 'agent']))
    .optional()
    .default(['tool', 'resource', 'prompt', 'agent']),
  debounceMs: z.number().int().nonnegative().optional().default(150),
  batchSize: z.number().int().positive().optional().default(50),
  reconcileOnStartup: z.boolean().optional().default(true),
  deleteOnShutdown: z.boolean().optional().default(false),
} satisfies RawZodShape<CloudAppIntegrationSyncOptionsInterface>);

export const cloudAppIntegrationPolicyOptionsSchema = z.object({
  enforce: z.boolean().optional().default(true),
  refreshIntervalMs: z.number().int().positive().optional().default(60_000),
  onFetchFailure: z.enum(['deny', 'allow', 'lastKnown']).optional().default('lastKnown'),
  invalidateWebhookPath: z.string().optional(),
} satisfies RawZodShape<CloudAppIntegrationPolicyOptionsInterface>);

// Nested `sync` / `policy` stay optional here — their inner fields each have
// their own `.optional().default(...)` so a bare `{}` parses to fully-populated
// defaults when the plugin resolves them downstream. Adding `.default({})` on
// the nested schemas clashes with the zod-v4 default signature (which expects
// the fully-populated output shape), so we let the plugin call
// `cloudAppIntegrationSyncOptionsSchema.parse(opts.sync ?? {})` instead.
export const cloudAppIntegrationOptionsSchema = z.object({
  enabled: z.boolean().optional().default(false),
  prefix: z.string().min(1).optional().default('frontmcp'),
  sync: cloudAppIntegrationSyncOptionsSchema.optional(),
  policy: cloudAppIntegrationPolicyOptionsSchema.optional(),
} satisfies RawZodShape<CloudAppIntegrationOptionsInterface>);

export const cloudOptionsSchema = z.object({
  clientId: z.string().min(1),
  secret: z.string().min(1),
  domain: z.string().min(1).optional().default('api.frontegg.com'),
  mcpGatewayUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  appId: z.string().optional(),
  refreshIntervalMs: z.number().int().positive().optional().default(60_000),
  auth: z.boolean().optional().default(true),
  approvals: approvalsNormalizedSchema,
  gateway: z.boolean().optional().default(true),
  guardrails: z.boolean().optional().default(true),
  appIntegration: cloudAppIntegrationOptionsSchema.optional(),
} satisfies RawZodShape<CloudOptionsInterface>);

export type CloudOptions = z.infer<typeof cloudOptionsSchema>;
export type CloudOptionsInput = CloudOptionsInterface;
export type CloudApprovalsOptions = z.infer<typeof cloudApprovalsOptionsSchema>;
export type CloudAppIntegrationOptions = z.infer<typeof cloudAppIntegrationOptionsSchema>;
export type CloudAppIntegrationSyncOptions = z.infer<typeof cloudAppIntegrationSyncOptionsSchema>;
export type CloudAppIntegrationPolicyOptions = z.infer<typeof cloudAppIntegrationPolicyOptionsSchema>;
