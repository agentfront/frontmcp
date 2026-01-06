/**
 * Zod validation schemas for approval types.
 *
 * @module @frontmcp/utils/approval
 */

import { z } from 'zod';
import { ApprovalScope, ApprovalState } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Basic Enums
// ─────────────────────────────────────────────────────────────────────────────

export const approvalScopeSchema = z.nativeEnum(ApprovalScope);

export const approvalStateSchema = z.nativeEnum(ApprovalState);

export const approvalMethodSchema = z.enum(['interactive', 'implicit', 'delegation', 'batch', 'api']);

export const approvalSourceTypeSchema = z.string().min(1);

export const revocationMethodSchema = z.enum(['interactive', 'implicit', 'policy', 'expiry']);

export const approvalCategorySchema = z.enum(['read', 'write', 'delete', 'execute', 'admin']);

export const riskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

export const approvalContextSchema = z.object({
  type: z.string().min(1),
  identifier: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Delegation
// ─────────────────────────────────────────────────────────────────────────────

export const delegationContextSchema = z.object({
  delegatorId: z.string().min(1),
  delegateId: z.string().min(1),
  purpose: z.string().optional(),
  constraints: z.record(z.string(), z.unknown()).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Grantor/Revoker
// ─────────────────────────────────────────────────────────────────────────────

export const approvalGrantorSchema = z.object({
  source: approvalSourceTypeSchema,
  identifier: z.string().optional(),
  displayName: z.string().optional(),
  method: approvalMethodSchema.optional(),
  origin: z.string().optional(),
  delegationContext: delegationContextSchema.optional(),
});

export const approvalRevokerSchema = z.object({
  source: z.string().min(1),
  identifier: z.string().optional(),
  displayName: z.string().optional(),
  method: revocationMethodSchema.optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Approval Record
// ─────────────────────────────────────────────────────────────────────────────

export const approvalRecordSchema = z.object({
  toolId: z.string().min(1),
  state: approvalStateSchema,
  scope: approvalScopeSchema,
  grantedAt: z.number(),
  expiresAt: z.number().optional(),
  ttlMs: z.number().optional(),
  sessionId: z.string().optional(),
  userId: z.string().optional(),
  context: approvalContextSchema.optional(),
  grantedBy: approvalGrantorSchema,
  approvalChain: z.array(approvalGrantorSchema).optional(),
  reason: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  revokedAt: z.number().optional(),
  revokedBy: approvalRevokerSchema.optional(),
  revocationReason: z.string().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool Approval Requirements
// ─────────────────────────────────────────────────────────────────────────────

export const toolApprovalRequirementSchema = z.object({
  required: z.boolean().optional(),
  defaultScope: approvalScopeSchema.optional(),
  allowedScopes: z.array(approvalScopeSchema).optional(),
  maxTtlMs: z.number().positive().optional(),
  alwaysPrompt: z.boolean().optional(),
  skipApproval: z.boolean().optional(),
  approvalMessage: z.string().optional(),
  category: approvalCategorySchema.optional(),
  riskLevel: riskLevelSchema.optional(),
  preApprovedContexts: z.array(approvalContextSchema).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Type inference helpers
// ─────────────────────────────────────────────────────────────────────────────

export type ApprovalContextInput = z.input<typeof approvalContextSchema>;
export type DelegationContextInput = z.input<typeof delegationContextSchema>;
export type ApprovalGrantorInput = z.input<typeof approvalGrantorSchema>;
export type ApprovalRevokerInput = z.input<typeof approvalRevokerSchema>;
export type ApprovalRecordInput = z.input<typeof approvalRecordSchema>;
export type ToolApprovalRequirementInput = z.input<typeof toolApprovalRequirementSchema>;
