/**
 * Zod validation schemas for approval types.
 *
 * @module @frontmcp/plugin-approval
 */
import { z } from 'zod';
import { ApprovalScope, ApprovalState } from './types';
export declare const approvalScopeSchema: z.ZodEnum<typeof ApprovalScope>;
export declare const approvalStateSchema: z.ZodEnum<typeof ApprovalState>;
export declare const approvalMethodSchema: z.ZodEnum<{
  api: 'api';
  interactive: 'interactive';
  implicit: 'implicit';
  delegation: 'delegation';
  batch: 'batch';
}>;
export declare const approvalSourceTypeSchema: z.ZodString;
export declare const revocationMethodSchema: z.ZodEnum<{
  policy: 'policy';
  interactive: 'interactive';
  implicit: 'implicit';
  expiry: 'expiry';
}>;
export declare const approvalCategorySchema: z.ZodEnum<{
  admin: 'admin';
  read: 'read';
  write: 'write';
  delete: 'delete';
  execute: 'execute';
}>;
export declare const riskLevelSchema: z.ZodEnum<{
  low: 'low';
  medium: 'medium';
  high: 'high';
  critical: 'critical';
}>;
export declare const approvalContextSchema: z.ZodObject<
  {
    type: z.ZodString;
    identifier: z.ZodString;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
  },
  z.core.$strip
>;
export declare const delegationContextSchema: z.ZodObject<
  {
    delegatorId: z.ZodString;
    delegateId: z.ZodString;
    purpose: z.ZodOptional<z.ZodString>;
    constraints: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
  },
  z.core.$strip
>;
export declare const approvalGrantorSchema: z.ZodObject<
  {
    source: z.ZodString;
    identifier: z.ZodOptional<z.ZodString>;
    displayName: z.ZodOptional<z.ZodString>;
    method: z.ZodOptional<
      z.ZodEnum<{
        api: 'api';
        interactive: 'interactive';
        implicit: 'implicit';
        delegation: 'delegation';
        batch: 'batch';
      }>
    >;
    origin: z.ZodOptional<z.ZodString>;
    delegationContext: z.ZodOptional<
      z.ZodObject<
        {
          delegatorId: z.ZodString;
          delegateId: z.ZodString;
          purpose: z.ZodOptional<z.ZodString>;
          constraints: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export declare const approvalRevokerSchema: z.ZodObject<
  {
    source: z.ZodString;
    identifier: z.ZodOptional<z.ZodString>;
    displayName: z.ZodOptional<z.ZodString>;
    method: z.ZodOptional<
      z.ZodEnum<{
        policy: 'policy';
        interactive: 'interactive';
        implicit: 'implicit';
        expiry: 'expiry';
      }>
    >;
  },
  z.core.$strip
>;
export declare const approvalRecordSchema: z.ZodObject<
  {
    toolId: z.ZodString;
    state: z.ZodEnum<typeof ApprovalState>;
    scope: z.ZodEnum<typeof ApprovalScope>;
    grantedAt: z.ZodNumber;
    expiresAt: z.ZodOptional<z.ZodNumber>;
    ttlMs: z.ZodOptional<z.ZodNumber>;
    sessionId: z.ZodOptional<z.ZodString>;
    userId: z.ZodOptional<z.ZodString>;
    context: z.ZodOptional<
      z.ZodObject<
        {
          type: z.ZodString;
          identifier: z.ZodString;
          metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        },
        z.core.$strip
      >
    >;
    grantedBy: z.ZodObject<
      {
        source: z.ZodString;
        identifier: z.ZodOptional<z.ZodString>;
        displayName: z.ZodOptional<z.ZodString>;
        method: z.ZodOptional<
          z.ZodEnum<{
            api: 'api';
            interactive: 'interactive';
            implicit: 'implicit';
            delegation: 'delegation';
            batch: 'batch';
          }>
        >;
        origin: z.ZodOptional<z.ZodString>;
        delegationContext: z.ZodOptional<
          z.ZodObject<
            {
              delegatorId: z.ZodString;
              delegateId: z.ZodString;
              purpose: z.ZodOptional<z.ZodString>;
              constraints: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            },
            z.core.$strip
          >
        >;
      },
      z.core.$strip
    >;
    approvalChain: z.ZodOptional<
      z.ZodArray<
        z.ZodObject<
          {
            source: z.ZodString;
            identifier: z.ZodOptional<z.ZodString>;
            displayName: z.ZodOptional<z.ZodString>;
            method: z.ZodOptional<
              z.ZodEnum<{
                api: 'api';
                interactive: 'interactive';
                implicit: 'implicit';
                delegation: 'delegation';
                batch: 'batch';
              }>
            >;
            origin: z.ZodOptional<z.ZodString>;
            delegationContext: z.ZodOptional<
              z.ZodObject<
                {
                  delegatorId: z.ZodString;
                  delegateId: z.ZodString;
                  purpose: z.ZodOptional<z.ZodString>;
                  constraints: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
                },
                z.core.$strip
              >
            >;
          },
          z.core.$strip
        >
      >
    >;
    reason: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    revokedAt: z.ZodOptional<z.ZodNumber>;
    revokedBy: z.ZodOptional<
      z.ZodObject<
        {
          source: z.ZodString;
          identifier: z.ZodOptional<z.ZodString>;
          displayName: z.ZodOptional<z.ZodString>;
          method: z.ZodOptional<
            z.ZodEnum<{
              policy: 'policy';
              interactive: 'interactive';
              implicit: 'implicit';
              expiry: 'expiry';
            }>
          >;
        },
        z.core.$strip
      >
    >;
    revocationReason: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
>;
export declare const toolApprovalRequirementSchema: z.ZodObject<
  {
    required: z.ZodOptional<z.ZodBoolean>;
    defaultScope: z.ZodOptional<z.ZodEnum<typeof ApprovalScope>>;
    allowedScopes: z.ZodOptional<z.ZodArray<z.ZodEnum<typeof ApprovalScope>>>;
    maxTtlMs: z.ZodOptional<z.ZodNumber>;
    alwaysPrompt: z.ZodOptional<z.ZodBoolean>;
    skipApproval: z.ZodOptional<z.ZodBoolean>;
    approvalMessage: z.ZodOptional<z.ZodString>;
    category: z.ZodOptional<
      z.ZodEnum<{
        admin: 'admin';
        read: 'read';
        write: 'write';
        delete: 'delete';
        execute: 'execute';
      }>
    >;
    riskLevel: z.ZodOptional<
      z.ZodEnum<{
        low: 'low';
        medium: 'medium';
        high: 'high';
        critical: 'critical';
      }>
    >;
    preApprovedContexts: z.ZodOptional<
      z.ZodArray<
        z.ZodObject<
          {
            type: z.ZodString;
            identifier: z.ZodString;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
          },
          z.core.$strip
        >
      >
    >;
  },
  z.core.$strip
>;
export type ApprovalContextInput = z.input<typeof approvalContextSchema>;
export type DelegationContextInput = z.input<typeof delegationContextSchema>;
export type ApprovalGrantorInput = z.input<typeof approvalGrantorSchema>;
export type ApprovalRevokerInput = z.input<typeof approvalRevokerSchema>;
export type ApprovalRecordInput = z.input<typeof approvalRecordSchema>;
export type ToolApprovalRequirementInput = z.input<typeof toolApprovalRequirementSchema>;
