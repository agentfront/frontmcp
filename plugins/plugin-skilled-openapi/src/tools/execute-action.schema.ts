import { z } from '@frontmcp/lazy-zod';

export const executeActionDescription = `Run one action from \`load_skill\` directly, with no script. The server authorizes the call, checks the input and the answer against the action's schemas, and sends the request with credentials it adds and never shows.

INPUT: { actionId, input? }: an \`actionId\` from \`load_skill\`, and an \`input\` matching that action's \`inputJsonSchema\` ({} or left out for an action that takes none).

Returns the action's data. A failure is an error result whose text says why: authority denied, invalid input, a timeout, or the API's status and error body, as in \`action "getTodo" failed with status 404: {"error":"not found"}\`. Its structured content is { ok: false, status, data?, error? }: \`data\` is the API's error body, \`status\` 0 means no answer.

To chain several actions in one call, passing data from one to the next, use \`run_workflow\`.`;

export const executeActionInputSchema = {
  actionId: z.string().min(1).max(256).describe('The actionId of an action load_skill returned'),
  input: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("The action's input, matching its inputJsonSchema; leave it out for an action that takes none"),
};

export type ExecuteActionInput = { actionId: string; input?: Record<string, unknown> };
