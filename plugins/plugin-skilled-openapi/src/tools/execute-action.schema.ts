import { z } from '@frontmcp/lazy-zod';

export const executeActionDescription = `Execute one action of a previously loaded skill.

Pipeline:
  1. Resolve (skillId, actionId) → bundled OpenAPI operation
  2. Authorize: caller's authInfo is checked against the action's required authorities (if any)
  3. Validate: the input is validated against the action's inputJsonSchema by the underlying executor
  4. Outbound: an HTTPS request is built and sent to the service the action belongs to,
     with credentials injected from the configured vault (never echoed back to you)
  5. Response: the response body is validated against outputJsonSchema and returned in
     a structured envelope. Failures (auth, schema, network) are returned as ok:false
     with a structured error string — they DO NOT throw.

INPUT: { skillId, actionId, input }
OUTPUT: { ok, status, data?, contentType?, error? }`;

export const executeActionInputSchema = {
  skillId: z.string().min(1).max(256).describe('Skill that owns the action'),
  actionId: z.string().min(1).max(256).describe('Action id (operationId) within the skill'),
  input: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Flat input object; keys correspond to the action inputJsonSchema properties'),
};

export const executeActionOutputSchema = {
  ok: z.boolean(),
  status: z.number().int(),
  data: z.unknown().optional(),
  contentType: z.string().optional(),
  error: z.string().optional(),
};

export type ExecuteActionInput = {
  skillId: string;
  actionId: string;
  input?: Record<string, unknown>;
};
export type ExecuteActionOutput = {
  ok: boolean;
  status: number;
  data?: unknown;
  contentType?: string;
  error?: string;
};
