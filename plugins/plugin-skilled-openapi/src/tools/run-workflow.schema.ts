import { z } from '@frontmcp/lazy-zod';

export const runWorkflowDescription = `Run an AgentScript program in a sandbox to chain several actions from \`load_skill\` in one call; for one action, use \`execute_action\`. Each action is authorized, schema-checked and sent with credentials the server adds and never shows.

In the script:
  - \`await callTool(actionId, input)\` runs an action and returns its data. A failure throws and ends the run; an HTTP failure includes the API's message: \`action "getTodo" failed with status 404: {"error":"not found"}\`.
  - \`await callTool(actionId, input, { throwOnError: false })\` returns \`{ ok, status, data, error? }\` instead: \`data\` is the API's error body, \`status\` 0 means no answer. There is no try/catch.
  - Only \`Math\` and \`JSON\` are available. End with \`return <value>\`.

Example:
  const t = await callTool("getTodo", { id: 1 });
  const u = await callTool("getUser", { id: t.userId }, { throwOnError: false });
  return { todo: t.title, owner: u.ok ? u.data.name : null };

Returns { success, value?, error?, stats }; a failed run is an error result.`;

export const runWorkflowInputSchema = {
  script: z
    .string()
    .min(1)
    .max(20000)
    .describe(
      'AgentScript source. Use `await callTool(actionId, input)` for loaded skill actions; end with `return <value>`.',
    ),
};

export const runWorkflowOutputSchema = {
  success: z.boolean(),
  value: z.unknown().optional(),
  error: z.string().optional(),
  stats: z
    .object({
      durationMs: z.number(),
      toolCalls: z.number(),
      steps: z.number(),
    })
    .optional(),
};

export type RunWorkflowInput = { script: string };
export type RunWorkflowOutput = {
  success: boolean;
  value?: unknown;
  error?: string;
  stats?: { durationMs: number; toolCalls: number; steps: number };
};
